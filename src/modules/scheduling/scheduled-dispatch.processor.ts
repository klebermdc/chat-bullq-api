import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { MessageContentType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { MessagesService } from '../messaging/messages/messages.service';
import { CadenceRunner } from '../cadences/cadence-runner.service';
import { ScheduledMessagesRepository } from './scheduled-messages.repository';
import { SCHEDULED_DISPATCH_QUEUE, SCHEDULED_DISPATCH_JOB } from './scheduling.constants';
import { isAiParked } from '../../common/utils/ai-parked.util';
import { computeWhatsappWindow } from '../messaging/conversations/whatsapp-window.util';
import { buildHsmTemplateContent } from './hsm-template-payload';

/** Conversa (parcial) que o dispatch carrega para decidir texto vs template. */
interface DispatchConversation {
  lastInboundAt: Date | null;
  channel?: { type: string } | null;
  contact?: { name: string | null; ctwaClidAt: Date | null } | null;
}

type OutboundPayload =
  | { ok: true; type: MessageContentType; content: Record<string, any> }
  | { ok: false; reason: string };

@Processor(SCHEDULED_DISPATCH_QUEUE, { concurrency: 5 })
export class ScheduledDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(ScheduledDispatchProcessor.name);

  constructor(
    private readonly repo: ScheduledMessagesRepository,
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
    @InjectQueue(SCHEDULED_DISPATCH_QUEUE) private readonly queue: Queue,
    @Inject(forwardRef(() => CadenceRunner))
    private readonly cadenceRunner: CadenceRunner,
  ) {
    super();
  }

  async process(job: Job<{ scheduledMessageId: string }>): Promise<void> {
    const row = await this.repo.findById(job.data.scheduledMessageId);
    if (!row || row.status !== 'PENDING') return; // idempotente

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: row.conversationId },
      select: {
        id: true, status: true, isArchived: true, lastInboundAt: true,
        assignedToId: true, awaitingHumanReply: true, aiEnabled: true,
        channel: { select: { type: true } },
        contact: { select: { name: true, ctwaClidAt: true } },
      },
    });
    if (!conversation || conversation.status === 'CLOSED' || conversation.isArchived) {
      await this.repo.update(row.id, {
        status: 'FAILED',
        failedReason: 'conversation_closed_or_archived',
      });
      return;
    }

    if (!row.createdById) {
      await this.repo.update(row.id, { status: 'FAILED', failedReason: 'no_sender' });
      return;
    }

    // Backstop: se o agendamento é cancelável ao responder e o cliente já
    // respondeu depois que ele foi criado, não envia (o auto-cancel pode ter
    // falhado). Cancela idempotentemente antes de reivindicar o envio.
    const replyCancelable =
      row.origin === 'AUTO_REENGAGE' ||
      row.origin === 'CADENCE' ||
      row.cancelOnReply === true;
    if (
      replyCancelable &&
      conversation.lastInboundAt &&
      row.createdAt &&
      conversation.lastInboundAt > row.createdAt
    ) {
      await this.repo.update(row.id, {
        status: 'CANCELED',
        canceledAt: new Date(),
        cancelReason: 'client_replied',
      });
      return;
    }

    // Corte "parado na IA": se o agendamento exige lead sob a IA e um humano
    // assumiu (ou a IA foi desligada) depois de criado, não envia. No
    // AUTO_REENGAGE isso também impede o próximo toque (return antes do retry).
    if (
      row.requireAiParked &&
      !isAiParked({
        assignedToId: conversation.assignedToId,
        awaitingHumanReply: conversation.awaitingHumanReply,
        aiEnabled: conversation.aiEnabled,
      })
    ) {
      await this.repo.update(row.id, {
        status: 'CANCELED',
        canceledAt: new Date(),
        cancelReason: 'not_ai_parked',
      });
      return;
    }

    // Fora da janela de 24h/72h (canal oficial) texto livre é recusado pela
    // Meta — o envio só passa como template HSM. Resolve aqui qual dos dois vai.
    const outbound = await this.resolveOutboundPayload(row, conversation);
    if (!outbound.ok) {
      this.logger.warn(
        `scheduled_dispatch_window_blocked id=${row.id} conv=${row.conversationId}: ${outbound.reason}`,
      );
      await this.repo.update(row.id, {
        status: 'FAILED',
        failedReason: outbound.reason,
      });
      // Mesmo bloqueado, a cadência precisa andar: uma matrícula parada em
      // ACTIVE bloqueia qualquer cadência futura naquela conversa (a guarda de
      // idempotência do `start` recusa enquanto houver enrollment vivo).
      this.advanceCadence(row);
      return;
    }

    const claimed = await this.repo.claimForDispatch(row.id);
    if (!claimed) return; // canceled or already picked up between read and now

    try {
      const sent = await this.messages.send(
        {
          conversationId: row.conversationId,
          type: outbound.type,
          content: outbound.content,
        },
        row.createdById,
        row.organizationId,
        'ALL',
        undefined,
        { system: true },
      );
      await this.repo.update(row.id, {
        status: 'SENT',
        sentMessageId: (sent as { id: string }).id,
        sentAt: new Date(),
      });

      // Hook de cadência: toque CADENCE enviado → avisa o runner para agendar
      // o próximo passo (ou encerrar como esgotado). Fire-and-forget.
      this.advanceCadence(row);

      // Auto-retry (só AUTO_REENGAGE): agenda o próximo disparo se ainda há
      // tentativas. O auto-cancel no inbound (Fase 1) cancela esse próximo se
      // o cliente responder antes.
      if (row.origin === 'AUTO_REENGAGE' && row.attempt < row.maxAttempts) {
        const nextAt = new Date(Date.now() + (row.retryEveryHours ?? 48) * 3600_000);
        const next = await this.repo.create({
          organizationId: row.organizationId,
          conversationId: row.conversationId,
          contactId: row.contactId,
          channelId: row.channelId,
          createdById: row.createdById,
          origin: 'AUTO_REENGAGE',
          contentType: row.contentType,
          content: row.content as any,
          scheduledAt: nextAt,
          attempt: row.attempt + 1,
          maxAttempts: row.maxAttempts,
          retryEveryHours: row.retryEveryHours,
          requireAiParked: row.requireAiParked,
          exhaustedStageId: row.exhaustedStageId,
        });
        const job = await this.queue.add(
          SCHEDULED_DISPATCH_JOB,
          { scheduledMessageId: next.id },
          {
            delay: Math.max(0, nextAt.getTime() - Date.now()),
            jobId: `sched-${next.id}`,
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );
        await this.repo.update(next.id, { jobId: String(job.id) });
      } else if (row.origin === 'AUTO_REENGAGE' && row.exhaustedStageId) {
        // Esgotou o burst (último toque enviado, sem resposta) → move/cria o
        // card do lead na etapa configurada (ex.: "Não respondeu").
        await this.moveCardToExhaustedStage(row, row.exhaustedStageId).catch((err) =>
          this.logger.warn(
            `exhausted_stage_move_failed conv=${row.conversationId}: ${(err as Error).message}`,
          ),
        );
      }
    } catch (err) {
      this.logger.error(`scheduled_dispatch_failed id=${row.id}: ${(err as Error).message}`);
      await this.repo.update(row.id, {
        status: 'FAILED',
        failedReason: (err as Error).message.slice(0, 500),
      });
    }
  }

  /**
   * Avisa o runner que este toque terminou (enviado ou bloqueado) para ele
   * agendar o próximo passo ou encerrar a matrícula. Fire-and-forget.
   */
  private advanceCadence(row: {
    origin: string;
    cadenceEnrollmentId?: string | null;
    cadenceStepOrder?: number | null;
  }): void {
    if (row.origin !== 'CADENCE' || !row.cadenceEnrollmentId) return;
    this.cadenceRunner
      .onStepSent(row.cadenceEnrollmentId, row.cadenceStepOrder ?? 0)
      .catch((err) =>
        this.logger.warn(
          `cadence_onStepSent_failed enrollment=${row.cadenceEnrollmentId}: ${(err as Error).message}`,
        ),
      );
  }

  /**
   * Decide o que sai de fato: o conteúdo agendado (texto livre/mídia) ou o
   * template HSM configurado no passo.
   *
   * Só troca quando a janela do canal oficial está fechada — aí texto livre não
   * é entregue pela Meta. Sem template utilizável, falha com motivo legível em
   * vez de queimar um envio que já se sabe recusado.
   */
  private async resolveOutboundPayload(
    row: {
      contentType: MessageContentType;
      content: unknown;
      templateId?: string | null;
      organizationId: string;
    },
    conversation: DispatchConversation,
  ): Promise<OutboundPayload> {
    const content = (row.content ?? {}) as Record<string, any>;
    // Já é template: nada a decidir (a Meta aceita HSM dentro e fora da janela).
    if (row.contentType === MessageContentType.TEMPLATE) {
      return { ok: true, type: row.contentType, content };
    }

    const window = computeWhatsappWindow({
      channelType: conversation.channel?.type ?? '',
      lastInboundAt: conversation.lastInboundAt ?? null,
      ctwaClidAt: conversation.contact?.ctwaClidAt ?? null,
      now: new Date(),
    });
    if (window.open) return { ok: true, type: row.contentType, content };

    if (!row.templateId) {
      return {
        ok: false,
        reason:
          'Janela de 24h/72h fechada e o passo não tem template HSM configurado — nada foi enviado.',
      };
    }

    const template = await this.prisma.messageTemplate.findFirst({
      where: { id: row.templateId, organizationId: row.organizationId },
    });
    if (!template || template.status !== 'APPROVED') {
      return {
        ok: false,
        reason: `Janela de 24h/72h fechada e o template HSM do passo não está aprovado (status=${template?.status ?? 'inexistente'}).`,
      };
    }

    const built = buildHsmTemplateContent(
      template,
      conversation.contact?.name ?? null,
    );
    if (!built) {
      return {
        ok: false,
        reason:
          'Janela de 24h/72h fechada e o template HSM do passo exige cabeçalho de mídia — não suportado em envio automático.',
      };
    }
    return { ok: true, type: MessageContentType.TEMPLATE, content: built };
  }

  /**
   * Move o card do lead para a etapa "ao esgotar" (status LOST). Se o lead
   * ainda não tem card (comum em leads parados na IA), cria um nessa etapa.
   */
  private async moveCardToExhaustedStage(
    row: { organizationId: string; conversationId: string; contactId: string },
    stageId: string,
  ): Promise<void> {
    const stage = await this.prisma.pipelineStage.findUnique({ where: { id: stageId } });
    if (!stage) return;
    const card = await this.prisma.card.findFirst({
      where: { conversationId: row.conversationId },
      orderBy: { createdAt: 'desc' },
    });
    if (card) {
      await this.prisma.card.update({
        where: { id: card.id },
        data: { stageId, status: 'LOST', closedAt: new Date() },
      });
      return;
    }
    const contact = await this.prisma.contact.findUnique({ where: { id: row.contactId } });
    await this.prisma.card.create({
      data: {
        organizationId: row.organizationId,
        pipelineId: stage.pipelineId,
        stageId,
        title: contact?.name || 'Lead sem resposta',
        contactId: row.contactId,
        conversationId: row.conversationId,
        status: 'LOST',
        closedAt: new Date(),
      },
    });
  }
}
