import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MessageContentType, ScheduledMessage } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ScheduledMessagesRepository } from './scheduled-messages.repository';
import { CreateScheduledMessageDto } from './dto/create-scheduled-message.dto';
import { UpdateScheduledMessageDto } from './dto/update-scheduled-message.dto';
import { ChannelAccess } from '../iam/channel-access/channel-access.service';
import { SCHEDULED_DISPATCH_QUEUE, SCHEDULED_DISPATCH_JOB } from './scheduling.constants';

@Injectable()
export class ScheduledMessagesService {
  private readonly logger = new Logger(ScheduledMessagesService.name);

  constructor(
    private readonly repo: ScheduledMessagesRepository,
    private readonly prisma: PrismaService,
    @InjectQueue(SCHEDULED_DISPATCH_QUEUE) private readonly queue: Queue,
    private readonly realtime: RealtimeGateway,
  ) {}

  async create(
    dto: CreateScheduledMessageDto,
    createdById: string,
    organizationId: string,
    access: ChannelAccess = 'ALL',
  ): Promise<ScheduledMessage> {
    const when = new Date(dto.scheduledAt);
    if (isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      throw new BadRequestException('scheduledAt deve ser uma data futura');
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: dto.conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.organizationId !== organizationId) throw new ForbiddenException();
    if (access !== 'ALL' && !access.has(conversation.channelId)) {
      throw new ForbiddenException();
    }

    const created = await this.repo.create({
      organizationId,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      channelId: conversation.channelId,
      createdById,
      origin: 'MANUAL',
      contentType: dto.type as MessageContentType,
      content: dto.content,
      quickReplyId: dto.quickReplyId ?? null,
      templateId: dto.templateId ?? null,
      scheduledAt: when,
      cancelOnReply: dto.cancelOnReply ?? false,
      maxAttempts: 1,
      attempt: 1,
    });

    const job = await this.queue.add(
      SCHEDULED_DISPATCH_JOB,
      { scheduledMessageId: created.id },
      {
        delay: Math.max(0, when.getTime() - Date.now()),
        jobId: `sched:${created.id}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    const updated = await this.repo.update(created.id, { jobId: String(job.id) });
    this.realtime.emitToConversation(conversation.id, 'scheduled:created', updated);
    return updated;
  }

  async listForConversation(
    conversationId: string,
    organizationId: string,
    access: ChannelAccess = 'ALL',
    status?: string,
  ): Promise<ScheduledMessage[]> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.organizationId !== organizationId) throw new ForbiddenException();
    if (access !== 'ALL' && !access.has(conversation.channelId)) {
      throw new ForbiddenException();
    }
    return this.repo.listByConversation(conversationId, status);
  }

  async cancel(id: string, organizationId: string, reason: string): Promise<ScheduledMessage> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Scheduled message not found');
    if (row.organizationId !== organizationId) throw new ForbiddenException();
    if (row.status !== 'PENDING') return row; // idempotente

    if (row.jobId) await this.queue.remove(row.jobId).catch(() => undefined);
    const updated = await this.repo.update(id, {
      status: 'CANCELED',
      canceledAt: new Date(),
      cancelReason: reason,
    });
    this.realtime.emitToConversation(row.conversationId, 'scheduled:canceled', updated);
    return updated;
  }

  /** Cancela todos os pendentes de uma conversa (usado no auto-cancel/fechamento). */
  async cancelPendingForConversation(
    conversationId: string,
    reason: string,
    origin?: string,
  ): Promise<number> {
    const pending = await this.repo.findPending(conversationId, origin);
    for (const row of pending) {
      if (row.jobId) await this.queue.remove(row.jobId).catch(() => undefined);
      const updated = await this.repo.update(row.id, {
        status: 'CANCELED',
        canceledAt: new Date(),
        cancelReason: reason,
      });
      this.realtime.emitToConversation(conversationId, 'scheduled:canceled', updated);
    }
    return pending.length;
  }

  async cancelPendingForConversationIfCancelOnReply(conversationId: string): Promise<number> {
    const pending = await this.repo.findPending(conversationId, 'MANUAL');
    const toCancel = pending.filter((p) => p.cancelOnReply);
    for (const row of toCancel) {
      if (row.jobId) await this.queue.remove(row.jobId).catch(() => undefined);
      const updated = await this.repo.update(row.id, {
        status: 'CANCELED',
        canceledAt: new Date(),
        cancelReason: 'client_replied',
      });
      this.realtime.emitToConversation(conversationId, 'scheduled:canceled', updated);
    }
    return toCancel.length;
  }

  async reschedule(
    id: string,
    dto: UpdateScheduledMessageDto,
    organizationId: string,
  ): Promise<ScheduledMessage> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Scheduled message not found');
    if (row.organizationId !== organizationId) throw new ForbiddenException();
    if (row.status !== 'PENDING') throw new BadRequestException('Só agendamentos pendentes podem ser editados');

    let scheduledAt = row.scheduledAt;
    if (dto.scheduledAt) {
      const when = new Date(dto.scheduledAt);
      if (isNaN(when.getTime()) || when.getTime() <= Date.now()) {
        throw new BadRequestException('scheduledAt deve ser uma data futura');
      }
      scheduledAt = when;
    }

    if (row.jobId) await this.queue.remove(row.jobId).catch(() => undefined);
    const job = await this.queue.add(
      SCHEDULED_DISPATCH_JOB,
      { scheduledMessageId: row.id },
      {
        delay: Math.max(0, scheduledAt.getTime() - Date.now()),
        jobId: `sched:${row.id}:${scheduledAt.getTime()}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    const updated = await this.repo.update(id, {
      scheduledAt,
      contentType: (dto.type as MessageContentType) ?? row.contentType,
      content: dto.content ?? (row.content as any),
      jobId: String(job.id),
    });
    this.realtime.emitToConversation(row.conversationId, 'scheduled:updated', updated);
    return updated;
  }
}
