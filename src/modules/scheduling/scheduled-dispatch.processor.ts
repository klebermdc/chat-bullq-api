import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { MessagesService } from '../messaging/messages/messages.service';
import { CadenceRunner } from '../cadences/cadence-runner.service';
import { ScheduledMessagesRepository } from './scheduled-messages.repository';
import { SCHEDULED_DISPATCH_QUEUE, SCHEDULED_DISPATCH_JOB } from './scheduling.constants';

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
      select: { id: true, status: true, isArchived: true, lastInboundAt: true },
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
    const replyCancelable = row.origin === 'AUTO_REENGAGE' || row.cancelOnReply === true;
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

    const claimed = await this.repo.claimForDispatch(row.id);
    if (!claimed) return; // canceled or already picked up between read and now

    try {
      const sent = await this.messages.send(
        {
          conversationId: row.conversationId,
          type: row.contentType,
          content: row.content as Record<string, any>,
        },
        row.createdById,
        row.organizationId,
        'ALL',
      );
      await this.repo.update(row.id, {
        status: 'SENT',
        sentMessageId: (sent as { id: string }).id,
        sentAt: new Date(),
      });

      // Hook de cadência: toque CADENCE enviado → avisa o runner para agendar
      // o próximo passo (ou encerrar como esgotado). Fire-and-forget.
      if (row.origin === 'CADENCE' && row.cadenceEnrollmentId) {
        this.cadenceRunner
          .onStepSent(row.cadenceEnrollmentId, row.cadenceStepOrder ?? 0)
          .catch((err) =>
            this.logger.warn(
              `cadence_onStepSent_failed enrollment=${row.cadenceEnrollmentId}: ${(err as Error).message}`,
            ),
          );
      }

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
      }
    } catch (err) {
      this.logger.error(`scheduled_dispatch_failed id=${row.id}: ${(err as Error).message}`);
      await this.repo.update(row.id, {
        status: 'FAILED',
        failedReason: (err as Error).message.slice(0, 500),
      });
    }
  }
}
