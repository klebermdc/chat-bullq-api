import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  MessageContentType,
  MessageDirection,
  MessageStatus,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import {
  isWithinHours,
  nextOpenAt,
  previousCloseAt,
  formatReturn,
  type BusinessHoursConfig,
} from './business-hours.util';

/**
 * Modo MESSAGE de `aiOffHoursMode`: manda o texto fixo `aiOutOfHoursMessage`
 * quando o lead escreve FORA do horário e a conversa ainda NÃO tem humano.
 * Envio de sistema (senderId null) pela fila `outbound-messages` — mesmo
 * caminho da IA, então não dispara efeitos de "humano respondeu".
 */
@Injectable()
export class OrgOffHoursNoticeService {
  private readonly logger = new Logger(OrgOffHoursNoticeService.name);
  private clock: () => Date = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    @InjectQueue('outbound-messages') private readonly outboundQueue: Queue,
  ) {}

  async onInboundReply(conversationId: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        organizationId: true,
        channelId: true,
        contactId: true,
        assignedToId: true,
        aiOffHoursMessageAt: true,
        contact: { select: { channels: { select: { channelId: true, externalId: true } } } },
      },
    });
    if (!conversation) return;
    if (conversation.assignedToId) return; // humano assumiu → aviso por-atendente cobre

    const org = await this.prisma.organization.findUnique({
      where: { id: conversation.organizationId },
      select: {
        aiOffHoursMode: true,
        aiBusinessHours: true,
        aiTimezone: true,
        aiOutOfHoursMessage: true,
      },
    });
    if (org?.aiOffHoursMode !== 'MESSAGE') return;
    const text0 = (org.aiOutOfHoursMessage ?? '').trim();
    if (!text0) return;

    const config = (org.aiBusinessHours ?? null) as BusinessHoursConfig | null;
    const tz = org.aiTimezone || 'America/Sao_Paulo';
    const now = this.clock();
    if (isWithinHours(config, tz, now)) return; // dentro do horário

    const nextOpen = nextOpenAt(config, tz, now);
    if (!nextOpen) return; // agenda vazia → sem âncora de dedup

    const closedAt = previousCloseAt(config, tz, now);
    if (conversation.aiOffHoursMessageAt && closedAt && conversation.aiOffHoursMessageAt >= closedAt) {
      return; // já avisado neste período fechado
    }

    const externalId = conversation.contact?.channels.find(
      (c) => c.channelId === conversation.channelId,
    )?.externalId;
    if (!externalId) return; // sem endereço no canal → nada a enviar

    const text = text0.replace(/\{proximo_horario\}/g, formatReturn(nextOpen, tz, now));

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        type: MessageContentType.TEXT,
        content: { text },
        status: MessageStatus.QUEUED,
        senderName: 'Atendimento',
        metadata: { automated: true, offHoursMessage: true },
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { aiOffHoursMessageAt: now, lastMessageAt: now },
    });

    this.realtime.emitToChannel(conversation.channelId, 'message:new', {
      message,
      conversationId: conversation.id,
      contactId: conversation.contactId,
    });
    this.realtime.emitToConversation(conversation.id, 'message:new', { message });

    await this.outboundQueue.add(
      'send-outbound',
      {
        messageId: message.id,
        channelId: conversation.channelId,
        contactExternalId: externalId,
        message: { type: MessageContentType.TEXT, content: { text } },
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true, removeOnFail: false },
    );
  }
}
