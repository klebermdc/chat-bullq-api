import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
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
} from '../scheduling/scheduling.constants';

/** De onde a cadência foi iniciada (gatilho manual ou entrada de etapa). */
export type CadenceStartSource = 'MANUAL' | 'STAGE_ENTER';

/** Um passo da cadência como devolvido pelo repositório (`findById`). */
interface CadenceStepLike {
  order: number;
  delayMinutes: number;
  contentType: MessageContentType;
  content: unknown;
  templateId?: string | null;
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
  ) {}

  async start(
    conversationId: string,
    cadenceId: string,
    source: CadenceStartSource,
    orgId?: string,
  ): Promise<CadenceEnrollment | null> {
    // Idempotência: qualquer enrollment ACTIVE na conversa → não duplica
    // (independe da cadência: uma conversa só tem uma cadência viva por vez).
    const existing =
      await this.enrollments.findActiveByConversation(conversationId);
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

    if (cadence.lostStageId && enrollment.cardId) {
      await this.moveCardToStage(enrollment.cardId, cadence.lostStageId);
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
    if (enrollment.status !== 'ACTIVE') return enrollment;

    // FIX 4: reivindica o encerramento atomicamente (compare-and-set em
    // ACTIVE). Só cancela toques/emite evento se este caminho venceu a corrida.
    const claimed = await this.enrollments.finishIfActive(enrollment.id, {
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
    const content = this.resolveContent(step.content, contact?.name ?? null);

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

  /** Substitui `{nome}` no `content.text` (formato TEXT); demais tipos passam direto. */
  private resolveContent(content: unknown, contactName: string | null): unknown {
    const nome = contactName ?? '';
    if (
      content &&
      typeof content === 'object' &&
      typeof (content as { text?: unknown }).text === 'string'
    ) {
      const c = content as { text: string };
      return { ...c, text: c.text.replace(/\{nome\}/g, nome) };
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

  private statusForReason(reason: string): CadenceEnrollmentStatus {
    switch (reason) {
      case 'said_no':
        return 'MOVED_LOST';
      case 'opt_out':
        return 'STOPPED_OPTOUT';
      case 'replied_yes':
      case 'engaged':
      case 'manual_handoff':
      default:
        return 'HANDED_OFF';
    }
  }
}
