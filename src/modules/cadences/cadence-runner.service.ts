import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  CadenceEnrollment,
  CadenceEnrollmentStatus,
  MessageContentType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { EnrollmentsRepository } from './enrollments.repository';
import { CadencesRepository } from './cadences.repository';
import { ScheduledMessagesRepository } from '../scheduling/scheduled-messages.repository';
import { ScheduledMessagesService } from '../scheduling/scheduled-messages.service';
import {
  SCHEDULED_DISPATCH_QUEUE,
  SCHEDULED_DISPATCH_JOB,
  CADENCE_SILENCE_QUEUE,
  CADENCE_SILENCE_JOB,
} from '../scheduling/scheduling.constants';
import { nextAllowedTime } from '../scheduling/inactivity/quiet-hours.util';

/** Quiet hours da retomada: 20h→8h no fuso padrão do Brasil (igual watchdog). */
const RESUME_QUIET_START = 20;
const RESUME_QUIET_END = 8;
const RESUME_TZ = 'America/Sao_Paulo';

/** De onde a cadência foi iniciada (gatilho manual ou entrada de etapa). */
export type CadenceStartSource = 'MANUAL' | 'STAGE_ENTER' | 'NO_REPLY';

/** Um passo da cadência como devolvido pelo repositório (`findById`). */
interface CadenceStepLike {
  order: number;
  delayMinutes: number;
  contentType: MessageContentType;
  content: unknown;
  options?: string[];
  templateId?: string | null;
}

/** Ordem canônica + rótulos das opções de resposta (rodapé numerado). */
const CADENCE_OPTION_ORDER = ['SIM', 'NAO', 'DESCADASTRAR'];
const CADENCE_OPTION_LABEL: Record<string, string> = {
  SIM: 'Sim',
  NAO: 'Não',
  DESCADASTRAR: 'Não quero mais receber',
};

/** Rodapé "1 - Sim\n2 - Não\n..." só com as opções habilitadas, em ordem. */
function buildOptionsFooter(options?: string[]): string {
  if (!options || options.length === 0) return '';
  const enabled = CADENCE_OPTION_ORDER.filter((o) => options.includes(o));
  if (enabled.length === 0) return '';
  return enabled
    .map((o, i) => `${i + 1} - ${CADENCE_OPTION_LABEL[o]}`)
    .join('\n');
}

/** Cadência (+steps) como devolvida por `findById`/`findByStage`. */
interface CadenceLike {
  id: string;
  organizationId: string;
  trigger: string;
  enabled: boolean;
  allowManual?: boolean;
  lostStageId?: string | null;
  optOutTagId?: string | null;
  watchedStageIds?: string[];
  steps: CadenceStepLike[];
}

/**
 * Motor de execução da cadência de negociação.
 *
 * - `start`: matricula a conversa (idempotente) e agenda o passo 1.
 * - `onStepSent`: chamado pelo dispatch após enviar um toque; agenda o próximo
 *   ou encerra como COMPLETED_NO_REPLY (movendo o card p/ etapa de perdido).
 * - `stop`: encerra o enrollment e cancela os toques pendentes (CADENCE).
 * - `maybeStartForStage`: hook de entrada de etapa (gatilho STAGE_ENTER/BOTH).
 *
 * Os toques são `ScheduledMessage(origin=CADENCE)` — reusa o dispatch + o
 * auto-cancel-no-reply já existentes no módulo `scheduling`.
 *
 * Fatia 1A: agenda em `now + delayMinutes` (sem deferir quiet hours). O util
 * `nextAllowedTime` (auto-reengage.service) fica reservado para a 1B.
 */
@Injectable()
export class CadenceRunner {
  private readonly logger = new Logger(CadenceRunner.name);

  constructor(
    private readonly enrollments: EnrollmentsRepository,
    private readonly cadences: CadencesRepository,
    private readonly schedRepo: ScheduledMessagesRepository,
    private readonly scheduledMessages: ScheduledMessagesService,
    private readonly prisma: PrismaService,
    @InjectQueue(SCHEDULED_DISPATCH_QUEUE) private readonly queue: Queue,
    private readonly realtime: RealtimeGateway,
    @InjectQueue(CADENCE_SILENCE_QUEUE) private readonly silenceQueue: Queue,
  ) {}

  async start(
    conversationId: string,
    cadenceId: string,
    source: CadenceStartSource,
    orgId?: string,
  ): Promise<CadenceEnrollment | null> {
    // Idempotência: qualquer enrollment VIVO (ACTIVE ou PAUSED) na conversa →
    // não duplica (independe da cadência: uma conversa só tem uma cadência viva
    // por vez).
    //
    // Precisa ser `findLive`, não `findActive`: o índice único parcial cobre
    // ACTIVE+PAUSED, então com um enrollment PAUSED esta guarda passava batido
    // e o create logo abaixo estourava P2002 — reentrar na etapa gatilho (ou
    // clicar em "iniciar cadência") virava erro em vez de no-op.
    const existing =
      await this.enrollments.findLiveByConversation(conversationId);
    if (existing) return existing;

    const cadence = (await this.cadences.findById(
      cadenceId,
    )) as CadenceLike | null;
    if (!cadence || cadence.steps.length === 0) return null;

    // FIX 1: no caminho manual (orgId presente) exige posse + habilitada +
    // permissão de start manual. Callers internos (orgId ausente) seguem.
    if (orgId && cadence.organizationId !== orgId) {
      throw new ForbiddenException('cadence_not_in_org');
    }
    if (!cadence.enabled) {
      if (orgId) throw new BadRequestException('cadence_disabled');
      return null; // segurança: cadência desabilitada nunca inicia
    }
    if (source === 'MANUAL' && orgId && !cadence.allowManual) {
      throw new BadRequestException('cadence_manual_not_allowed');
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) return null;
    if (orgId && conversation.organizationId !== orgId) {
      throw new ForbiddenException('conversation_not_in_org');
    }

    // Guarda de opt-out: contato marcado como descadastrado → não matricula.
    if (cadence.optOutTagId) {
      const optOut = await this.prisma.contactTag.findUnique({
        where: {
          contactId_tagId: {
            contactId: conversation.contactId,
            tagId: cadence.optOutTagId,
          },
        },
      });
      if (optOut) return null;
    }

    const contact = await this.prisma.contact.findUnique({
      where: { id: conversation.contactId },
    });
    const card = await this.prisma.card.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    });

    const firstStep = cadence.steps[0];
    const enrollment = await this.enrollments.create({
      organizationId: conversation.organizationId,
      cadenceId: cadence.id,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      cardId: card?.id ?? null,
      currentStep: firstStep.order,
      status: 'ACTIVE',
    });

    await this.scheduleStep(enrollment, conversation, contact, firstStep);

    this.realtime.emitToConversation(conversationId, 'cadence:started', {
      enrollmentId: enrollment.id,
      cadenceId: cadence.id,
      source,
      currentStep: firstStep.order,
    });
    return enrollment;
  }

  async onStepSent(enrollmentId: string, stepOrder: number): Promise<void> {
    const enrollment = await this.enrollments.findById(enrollmentId);
    if (!enrollment || enrollment.status !== 'ACTIVE') return;

    const cadence = (await this.cadences.findById(
      enrollment.cadenceId,
    )) as CadenceLike | null;
    if (!cadence) return;

    const steps = cadence.steps;
    const currentIdx = steps.findIndex(
      (s) => s.order === enrollment.currentStep,
    );
    const next = currentIdx >= 0 ? steps[currentIdx + 1] : undefined;

    if (next) {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: enrollment.conversationId },
      });
      if (!conversation) return;
      const contact = await this.prisma.contact.findUnique({
        where: { id: enrollment.contactId },
      });

      await this.scheduleStep(enrollment, conversation, contact, next);
      await this.enrollments.update(enrollment.id, {
        currentStep: next.order,
        lastStepAt: new Date(),
      });
      this.realtime.emitToConversation(
        enrollment.conversationId,
        'cadence:step',
        { enrollmentId: enrollment.id, currentStep: next.order },
      );
      return;
    }

    // Sem próximo passo → esgotou sem resposta. Reivindica o encerramento de
    // forma atômica (compare-and-set em ACTIVE): se outro caminho já finalizou
    // (ex.: resposta do cliente em paralelo), não aplica efeitos colaterais.
    const claimed = await this.enrollments.finishIfActive(enrollment.id, {
      status: 'COMPLETED_NO_REPLY',
      endedAt: new Date(),
      endReason: 'exhausted',
    });
    if (!claimed) return;

    if (cadence.lostStageId) {
      await this.ensureCardInStage(enrollment, cadence.lostStageId);
    }
    this.realtime.emitToConversation(
      enrollment.conversationId,
      'cadence:completed',
      { enrollmentId: enrollment.id },
    );
  }

  async stop(
    enrollmentId: string,
    reason: string,
    orgId?: string,
  ): Promise<CadenceEnrollment | null> {
    const enrollment = await this.enrollments.findById(enrollmentId);
    if (!enrollment) return null;

    // FIX 1: endpoint manual passa orgId → bloqueia acesso cross-tenant.
    if (orgId && enrollment.organizationId !== orgId) {
      throw new ForbiddenException('enrollment_not_in_org');
    }

    // Pré-check barato em memória; a porta autoritativa é o write condicional.
    if (enrollment.status !== 'ACTIVE' && enrollment.status !== 'PAUSED') {
      return enrollment;
    }

    // FIX 4: reivindica o encerramento atomicamente (compare-and-set em
    // ACTIVE). Só cancela toques/emite evento se este caminho venceu a corrida.
    const claimed = await this.enrollments.finishIfLive(enrollment.id, {
      status: this.statusForReason(reason),
      endedAt: new Date(),
      endReason: reason,
    });
    if (!claimed) return enrollment;

    // Cancela os toques CADENCE ainda pendentes desta conversa.
    await this.scheduledMessages.cancelPendingForConversation(
      enrollment.conversationId,
      reason,
      'CADENCE',
    );

    this.realtime.emitToConversation(
      enrollment.conversationId,
      'cadence:stopped',
      { enrollmentId: enrollment.id, reason },
    );
    return this.enrollments.findById(enrollment.id);
  }

  /**
   * Resposta fraca do cliente: pausa a cadência (ACTIVE→PAUSED), cancela os
   * toques pendentes e arma o watchdog de silêncio. Devolve o enrollment só
   * quando ESTE caminho venceu o compare-and-set; `null` caso contrário.
   */
  async pause(
    enrollmentId: string,
    silenceWindowMinutes: number,
  ): Promise<CadenceEnrollment | null> {
    const claimed = await this.enrollments.pauseIfActive(enrollmentId, {
      status: 'PAUSED',
      pausedAt: new Date(),
    });
    if (!claimed) return null;

    const enrollment = await this.enrollments.findById(enrollmentId);
    if (!enrollment) return null;

    await this.scheduledMessages.cancelPendingForConversation(
      enrollment.conversationId,
      'paused_weak_reply',
      'CADENCE',
    );

    const delay = Math.max(0, silenceWindowMinutes) * 60_000;
    await this.silenceQueue.add(
      CADENCE_SILENCE_JOB,
      { enrollmentId },
      {
        delay,
        jobId: `cadsil-${enrollmentId}-${Date.now() + delay}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    this.realtime.emitToConversation(enrollment.conversationId, 'cadence:paused', {
      enrollmentId,
    });
    return enrollment;
  }

  /**
   * Retomada MANUAL (atendente clicou "Retomar agora"): não espera a janela de
   * silêncio do watchdog, dispara o próximo toque no primeiro horário permitido.
   *
   * Quiet hours continuam valendo — o atendente decide *retomar*, não decide
   * mandar mensagem 23h. Mesma regra do watchdog (`RESUME_QUIET_*`), via util
   * puro para não injetar `AutoReengageService` através do forwardRef
   * cadences↔scheduling.
   */
  async resumeNow(enrollmentId: string, orgId: string): Promise<void> {
    const enrollment = await this.enrollments.findById(enrollmentId);
    if (!enrollment) throw new NotFoundException('enrollment_not_found');
    if (enrollment.organizationId !== orgId) {
      throw new ForbiddenException('enrollment_not_in_org');
    }
    if (enrollment.status !== 'PAUSED') {
      throw new BadRequestException('enrollment_not_paused');
    }
    const dispatchAt = nextAllowedTime(
      new Date(),
      RESUME_QUIET_START,
      RESUME_QUIET_END,
      RESUME_TZ,
    );
    await this.resumeAtStep(enrollmentId, dispatchAt);
  }

  /**
   * Retomada após silêncio: reivindica PAUSED→ACTIVE e reagenda o passo atual
   * (o que fora cancelado na pausa) no instante `dispatchAt`. Sem próximo passo
   * possível → encerra como esgotado.
   */
  async resumeAtStep(enrollmentId: string, dispatchAt: Date): Promise<void> {
    const claimed = await this.enrollments.resumeIfPaused(enrollmentId, {
      status: 'ACTIVE',
    });
    if (!claimed) return;

    const enrollment = await this.enrollments.findById(enrollmentId);
    if (!enrollment) return;

    const cadence = (await this.cadences.findById(
      enrollment.cadenceId,
    )) as CadenceLike | null;
    if (!cadence) return;

    const step = cadence.steps.find((s) => s.order === enrollment.currentStep);
    if (!step) {
      await this.enrollments.finishIfActive(enrollment.id, {
        status: 'COMPLETED_NO_REPLY',
        endedAt: new Date(),
        endReason: 'exhausted',
      });
      return;
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: enrollment.conversationId },
    });
    if (!conversation) return;
    const contact = await this.prisma.contact.findUnique({
      where: { id: enrollment.contactId },
    });

    await this.scheduleStepAt(enrollment, conversation, contact, step, dispatchAt);
    this.realtime.emitToConversation(enrollment.conversationId, 'cadence:resumed', {
      enrollmentId: enrollment.id,
      currentStep: step.order,
    });
  }

  async maybeStartForStage(
    conversationId: string,
    _cardId: string | null,
    stageId: string,
    orgId: string,
  ): Promise<CadenceEnrollment | null> {
    const cadence = (await this.cadences.findByStage(
      orgId,
      stageId,
    )) as CadenceLike | null;
    if (!cadence || !cadence.enabled) return null;
    if (cadence.trigger !== 'STAGE_ENTER' && cadence.trigger !== 'BOTH') {
      return null;
    }
    return this.start(conversationId, cadence.id, 'STAGE_ENTER');
  }

  /**
   * Gatilho de reengajamento de entrada. Chamado (fire-and-forget) quando a
   * Aline (agente IA) envia uma mensagem. Inscreve apenas se:
   *  - existe cadência NO_REPLY habilitada na org;
   *  - a conversa está PRÉ-HUMANA (sem responsável e sem aguardar humano);
   *  - o card está numa etapa monitorada (ou watchedStageIds vazio = qualquer).
   * A idempotência (1 enrollment ACTIVE/conversa) e o opt-out são garantidos
   * por `start()`.
   */
  async maybeStartForNoReply(
    conversationId: string,
  ): Promise<CadenceEnrollment | null> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) return null;

    // Pré-humano e IA ativa (parado na fase da Aline). aiEnabled=false = IA
    // desligada manualmente na conversa → não reengaja.
    if (
      conversation.assignedToId ||
      conversation.awaitingHumanReply ||
      conversation.aiEnabled === false
    ) {
      return null;
    }

    const cadence = (await this.cadences.findNoReply(
      conversation.organizationId,
    )) as CadenceLike | null;
    if (!cadence || !cadence.enabled) return null;
    if (cadence.trigger !== 'NO_REPLY') return null;

    const watched = cadence.watchedStageIds ?? [];
    if (watched.length > 0) {
      const card = await this.prisma.card.findFirst({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
      });
      if (!card || !card.stageId || !watched.includes(card.stageId)) {
        return null;
      }
    }

    return this.start(conversationId, cadence.id, 'NO_REPLY');
  }

  // ─── helpers ──────────────────────────────────────────────

  /** Cria o ScheduledMessage do passo e o enfileira no dispatch. */
  private async scheduleStep(
    enrollment: CadenceEnrollment,
    conversation: {
      id: string;
      organizationId: string;
      channelId: string;
      assignedToId?: string | null;
    },
    contact: { name?: string | null } | null,
    step: CadenceStepLike,
  ): Promise<void> {
    const scheduledAt = new Date(Date.now() + step.delayMinutes * 60_000);
    await this.scheduleStepAt(enrollment, conversation, contact, step, scheduledAt);
  }

  /** Como `scheduleStep`, mas em um instante explícito (usado na retomada). */
  private async scheduleStepAt(
    enrollment: CadenceEnrollment,
    conversation: {
      id: string;
      organizationId: string;
      channelId: string;
      assignedToId?: string | null;
    },
    contact: { name?: string | null } | null,
    step: CadenceStepLike,
    scheduledAt: Date,
  ): Promise<void> {
    const content = this.resolveContent(
      step.content,
      contact?.name ?? null,
      step.options,
    );

    // O disparo (MessagesService.send) exige um usuário remetente. A cadência é
    // iniciada pelo sistema, então resolvemos: responsável da conversa, senão
    // o OWNER da org. Sem isso o toque falha com `no_sender`.
    const createdById = await this.resolveSystemSender(
      conversation.organizationId,
      conversation.assignedToId ?? null,
    );
    if (!createdById) {
      this.logger.warn(
        `cadence_no_sender conv=${conversation.id} org=${conversation.organizationId} — sem responsável/OWNER; toque não será enviado`,
      );
    }

    const sm = await this.schedRepo.create({
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      contactId: enrollment.contactId,
      channelId: conversation.channelId,
      createdById,
      origin: 'CADENCE',
      cadenceEnrollmentId: enrollment.id,
      cadenceStepOrder: step.order,
      contentType: step.contentType,
      content: content as Prisma.InputJsonValue,
      templateId: step.templateId ?? null,
      scheduledAt,
      maxAttempts: 1,
      attempt: 1,
      requireAiParked: true,
    });

    // IMPORTANTE: jobId custom do BullMQ NÃO pode conter ':' → `sched-<id>`.
    const job = await this.queue.add(
      SCHEDULED_DISPATCH_JOB,
      { scheduledMessageId: sm.id },
      {
        delay: Math.max(0, scheduledAt.getTime() - Date.now()),
        jobId: `sched-${sm.id}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
    await this.schedRepo.update(sm.id, { jobId: String(job.id) });
  }

  /** Remetente do sistema: responsável da conversa, senão o OWNER da org. */
  private async resolveSystemSender(
    organizationId: string,
    assignedToId: string | null,
  ): Promise<string | null> {
    if (assignedToId) return assignedToId;
    const owner = await this.prisma.userOrganization.findFirst({
      where: { organizationId, role: 'OWNER' },
      select: { userId: true },
    });
    return owner?.userId ?? null;
  }

  /**
   * Substitui `{nome}` no `content.text` (formato TEXT) e anexa o rodapé
   * numerado das opções ("1 - Sim / 2 - Não / ..."), pra o cliente saber como
   * responder (o classificador entende 1/2/3 ou as palavras). Demais tipos
   * (mídia/template) passam direto.
   */
  private resolveContent(
    content: unknown,
    contactName: string | null,
    options?: string[],
  ): unknown {
    const nome = contactName ?? '';
    if (
      content &&
      typeof content === 'object' &&
      typeof (content as { text?: unknown }).text === 'string'
    ) {
      const c = content as { text: string };
      let text = c.text.replace(/\{nome\}/g, nome);
      const footer = buildOptionsFooter(options);
      if (footer) text = `${text}\n\n${footer}`;
      return { ...c, text };
    }
    return content;
  }

  private async moveCardToStage(
    cardId: string,
    stageId: string,
  ): Promise<void> {
    await this.prisma.card.update({
      where: { id: cardId },
      data: { stageId, status: 'LOST', closedAt: new Date() },
    });
  }

  /**
   * Garante que o lead apareça na etapa destino ao esgotar. Se o enrollment já
   * tem card, move; senão cria um card nessa etapa (leads pré-humanos do
   * reengajamento normalmente ainda não têm card no board).
   */
  private async ensureCardInStage(
    enrollment: {
      organizationId: string;
      conversationId: string;
      contactId: string;
      cardId: string | null;
    },
    stageId: string,
  ): Promise<void> {
    if (enrollment.cardId) {
      await this.moveCardToStage(enrollment.cardId, stageId);
      return;
    }
    const stage = await this.prisma.pipelineStage.findUnique({
      where: { id: stageId },
    });
    if (!stage) return;
    const contact = await this.prisma.contact.findUnique({
      where: { id: enrollment.contactId },
    });
    await this.prisma.card.create({
      data: {
        organizationId: enrollment.organizationId,
        pipelineId: stage.pipelineId,
        stageId,
        title: contact?.name || 'Lead sem resposta',
        contactId: enrollment.contactId,
        conversationId: enrollment.conversationId,
        status: 'LOST',
        closedAt: new Date(),
      },
    });
  }

  private statusForReason(reason: string): CadenceEnrollmentStatus {
    switch (reason) {
      case 'said_no':
        return 'MOVED_LOST';
      case 'opt_out':
        return 'STOPPED_OPTOUT';
      case 'client_replied':
        return 'RESUMED_AI';
      case 'replied_yes':
      case 'engaged':
      case 'manual_handoff':
      default:
        return 'HANDED_OFF';
    }
  }
}
