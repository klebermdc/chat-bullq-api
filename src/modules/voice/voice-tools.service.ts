import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { MessageContentType, MessageDirection, MessageStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { AgendaService } from '../agenda/agenda.service';
import { computeWhatsappWindow } from '../messaging/conversations/whatsapp-window.util';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { DEFAULT_TIMEZONE } from '../response-sla/response-sla.rules';

// Valores como texto, tipados pelo Prisma.
const OUTBOUND: MessageDirection = 'OUTBOUND';
const TEXT: MessageContentType = 'TEXT';
const SYSTEM: MessageContentType = 'SYSTEM';
const SENT: MessageStatus = 'SENT';
const QUEUED: MessageStatus = 'QUEUED';

const MAX_NOTES = 500;

/** "segunda-feira, 16/11 às 15:00" no fuso da empresa. */
export function slotLabel(date: Date, tz: string): string {
  const day = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, weekday: 'long', day: '2-digit', month: '2-digit' }).format(date);
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return `${day} às ${time}`;
}

export function confirmationText(sellerName: string, when: string): string {
  return `Combinado! ${sellerName} vai te ligar ${when}. Qualquer coisa, é só chamar por aqui.`;
}

/**
 * Ferramentas que o agente de voz chama durante a ligação. A empresa, o
 * vendedor e o contato saem SEMPRE da conversa — nunca do agente.
 */
@Injectable()
export class VoiceToolsService {
  private readonly logger = new Logger(VoiceToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agenda: AgendaService,
    private readonly realtime: RealtimeGateway,
    @InjectQueue('outbound-messages') private readonly outboundQueue: Queue,
  ) {}

  private async loadConversation(conversationId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        channelId: true,
        contactId: true,
        assignedToId: true,
        lastInboundAt: true,
        metaWindowExpiresAt: true,
        channel: { select: { type: true } },
        contact: { select: { name: true, ctwaClidAt: true } },
        assignedTo: { select: { name: true } },
        organization: { select: { aiTimezone: true } },
      },
    });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    if (!conv.assignedToId) throw new BadRequestException({ code: 'SEM_VENDEDOR', message: 'Conversa sem vendedor responsável' });
    return { ...conv, ownerUserId: conv.assignedToId, tz: conv.organization?.aiTimezone || DEFAULT_TIMEZONE };
  }

  async freeSlots(conversationId: string, count = 4) {
    const conv = await this.loadConversation(conversationId);
    const slots = await this.agenda.freeSlots(conv.organizationId, conv.ownerUserId, { count });
    return {
      vendedor: conv.assignedTo?.name ?? null,
      horarios: slots.map((d) => ({ inicio: d.toISOString(), falado: slotLabel(d, conv.tz) })),
    };
  }

  async schedule(input: { conversationId: string; startsAt: string; notes?: string; callId?: string }) {
    const conv = await this.loadConversation(input.conversationId);
    const card = await this.prisma.card.findFirst({
      where: { conversationId: conv.id, organizationId: conv.organizationId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    const appt = await this.agenda.createForAline(
      conv.organizationId,
      conv.ownerUserId,
      {
        contactId: conv.contactId,
        conversationId: conv.id,
        cardId: card?.id,
        startsAt: input.startsAt,
        notes: input.notes?.slice(0, MAX_NOTES),
        callId: input.callId,
      },
      'ALINE_VOZ',
    );
    const seller = conv.assignedTo?.name ?? 'O vendedor';
    const when = slotLabel(appt.startsAt, conv.tz);
    await this.postSystemNote(conv, `📅 Aline marcou retorno com ${seller}: ${when}.${appt.notes ? ` Obs.: ${appt.notes}` : ''}`, appt.id);
    const confirmacaoEnviada = await this.sendConfirmation(conv, confirmationText(seller, when));
    return { ok: true, compromissoId: appt.id, falado: when, confirmacaoEnviada };
  }

  private async postSystemNote(conv: { id: string; channelId: string; contactId: string }, text: string, appointmentId: string) {
    const message = await this.prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: OUTBOUND,
        type: SYSTEM,
        status: SENT,
        sentAt: new Date(),
        content: { text, appointmentId },
        metadata: { source: 'voice', appointmentId },
      },
    });
    this.realtime.emitToChannel(conv.channelId, 'message:new', { message, conversationId: conv.id, contactId: conv.contactId });
    this.realtime.emitToConversation(conv.id, 'message:new', { message });
  }

  /** Só manda se a janela do WhatsApp estiver aberta (texto livre fora dela é recusado pela Meta). */
  private async sendConfirmation(
    conv: Awaited<ReturnType<VoiceToolsService['loadConversation']>>,
    text: string,
  ): Promise<boolean> {
    const window = computeWhatsappWindow({
      channelType: conv.channel?.type ?? '',
      lastInboundAt: conv.lastInboundAt ?? null,
      ctwaClidAt: conv.contact?.ctwaClidAt ?? null,
      metaWindowExpiresAt: conv.metaWindowExpiresAt ?? null,
      now: new Date(),
    });
    if (!window.open) return false;
    const contactChannel = await this.prisma.contactChannel.findFirst({
      where: { contactId: conv.contactId, channelId: conv.channelId },
      select: { externalId: true },
    });
    if (!contactChannel?.externalId) return false;
    const message = await this.prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: OUTBOUND,
        type: TEXT,
        content: { text },
        status: QUEUED,
        senderName: 'Aline',
        metadata: { source: 'voice', kind: 'agenda_confirmacao' },
      },
    });
    this.realtime.emitToConversation(conv.id, 'message:new', { message });
    await this.outboundQueue.add(
      'send-outbound',
      { messageId: message.id, channelId: conv.channelId, contactExternalId: contactChannel.externalId, message: { type: TEXT, content: { text } } },
      { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true, removeOnFail: false },
    );
    this.logger.log(`Confirmação de retorno enviada na conversa ${conv.id}`);
    return true;
  }
}
