import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { MessagesService } from '../messaging/messages/messages.service';
import { ScheduledMessagesRepository } from './scheduled-messages.repository';
import { SCHEDULED_DISPATCH_QUEUE } from './scheduling.constants';

@Processor(SCHEDULED_DISPATCH_QUEUE, { concurrency: 5 })
export class ScheduledDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(ScheduledDispatchProcessor.name);

  constructor(
    private readonly repo: ScheduledMessagesRepository,
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
  ) {
    super();
  }

  async process(job: Job<{ scheduledMessageId: string }>): Promise<void> {
    const row = await this.repo.findById(job.data.scheduledMessageId);
    if (!row || row.status !== 'PENDING') return; // idempotente

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: row.conversationId },
      select: { id: true, status: true, isArchived: true },
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
    } catch (err) {
      this.logger.error(`scheduled_dispatch_failed id=${row.id}: ${(err as Error).message}`);
      await this.repo.update(row.id, {
        status: 'FAILED',
        failedReason: (err as Error).message.slice(0, 500),
      });
    }
  }
}
