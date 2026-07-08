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
}
