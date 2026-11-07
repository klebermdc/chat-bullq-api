import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  ConversationStatus,
  MessageContentType,
  MessageDirection,
  MessageStatus,
  Prisma,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { firstName } from '../scheduling/hsm-template-payload';
import { tagConversation } from './website-lead-tags';
import {
  DECLINE_BUTTON_TEXT,
  DECLINE_REPLY,
  GUIAMENTO_TAG,
  SITE_ORIGIN_WINDOW_MS,
  SITE_TAG,
} from './website-leads.constants';

export interface WebsiteLeadInboundInput {
  organizationId: string;
  channelId: string;
  conversationId: string;
  contactId: string;
  /** Conversa criada ou reaberta por esta mensagem. */
  conversationIsNewOrReopened: boolean;
  text: string | null;
}

export interface WebsiteLeadInboundDecision {
  /** Não manda para a carteira (que desligaria a IA). */
  skipLegacyRouting: boolean;
  /** Não dispara o chatbot de boas-vindas por cima da Aline. */
  skipChatbot: boolean;
  /** Já respondido aqui ("Agora não"): a IA não roda. */
  skipAi: boolean;
}

const NONE: WebsiteLeadInboundDecision = {
  skipLegacyRouting: false,
  skipChatbot: false,
  skipAi: false,
};

function normalize(s: string | null): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim();
}

/**
 * Regras do lead do site no pipeline de entrada (mensagem nova do cliente):
 *
 *  - conversa aberta pelo retorno automático (`aiUntilHandoff` ou
 *    `metadata.websiteLead`): a Aline conduz. A carteira não desliga a IA e o
 *    chatbot não entra por cima;
 *  - "Agora não" no botão do template: agradece, desliga a IA, sem insistir;
 *  - conversa nova de quem preencheu o site há pouco: etiqueta "Site".
 */
@Injectable()
export class WebsiteLeadInboundService {
  private readonly logger = new Logger(WebsiteLeadInboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    @InjectQueue('outbound-messages') private readonly outboundQueue: Queue,
  ) {}

  async evaluate(input: WebsiteLeadInboundInput): Promise<WebsiteLeadInboundDecision> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: {
        aiUntilHandoff: true,
        metadata: true,
        assignedToId: true,
        status: true,
        activeAgentId: true,
      },
    });
    if (!conv) return NONE;

    const websiteLead = ((conv.metadata ?? {}) as Record<string, any>).websiteLead;
    const followupActive = !!websiteLead?.followupSentAt && !websiteLead?.declinedAt;
    if (conv.aiUntilHandoff || followupActive) {
      if (followupActive && normalize(input.text) === DECLINE_BUTTON_TEXT) {
        await this.decline(input, conv, websiteLead);
        return { skipLegacyRouting: true, skipChatbot: true, skipAi: true };
      }
      return { skipLegacyRouting: true, skipChatbot: true, skipAi: false };
    }

    if (input.conversationIsNewOrReopened) {
      await this.tagIfRecentSiteLead(input).catch((err: Error) =>
        this.logger.warn(`etiqueta Site falhou conv=${input.conversationId}: ${err.message}`),
      );
    }
    return NONE;
  }

  private async decline(
    input: WebsiteLeadInboundInput,
    conv: { assignedToId: string | null; status: ConversationStatus; activeAgentId: string | null; metadata: unknown },
    websiteLead: Record<string, unknown>,
  ): Promise<void> {
    const [contact, agent] = await Promise.all([
      this.prisma.contact.findUnique({ where: { id: input.contactId }, select: { name: true } }),
      conv.activeAgentId
        ? this.prisma.aiAgent.findUnique({ where: { id: conv.activeAgentId }, select: { name: true } })
        : null,
    ]);
    const name = firstName(contact?.name);
    await this.sendText(input, DECLINE_REPLY.replace('{nome}', name ? `, ${name}` : ''), agent?.name);

    // Sem dono, a conversa só existia pelo retorno: encerra (de PENDING não
    // pede avaliação). Com vendedor, fica aberta para ele ver.
    const closes =
      !conv.assignedToId &&
      (conv.status === ConversationStatus.PENDING || conv.status === ConversationStatus.BOT);
    const metadata = (conv.metadata ?? {}) as Record<string, unknown>;
    const updated = await this.prisma.conversation.update({
      where: { id: input.conversationId },
      data: {
        aiEnabled: false,
        aiDisabledAt: new Date(),
        aiUntilHandoff: false,
        activeAgentId: null,
        awaitingHumanReply: false,
        ...(closes ? { status: ConversationStatus.CLOSED, closedAt: new Date() } : {}),
        metadata: {
          ...metadata,
          websiteLead: { ...websiteLead, declinedAt: new Date().toISOString() },
        } as Prisma.InputJsonValue,
      },
    });
    if (closes) {
      await this.prisma.conversationAuditLog.create({
        data: {
          conversationId: input.conversationId,
          action: 'STATUS_CHANGED',
          fromValue: conv.status,
          toValue: ConversationStatus.CLOSED,
          metadata: { trigger: 'website_lead_declined' },
        },
      });
    }
    await this.prisma.leadSubmission.updateMany({
      where: { followupConversationId: input.conversationId, followupStatus: 'SENT' },
      data: { followupStatus: 'DECLINED', followupReason: 'agora_nao' },
    });
    this.realtime.emitToChannel(input.channelId, 'conversation:updated', { conversation: updated });
    this.realtime.emitToConversation(input.conversationId, 'conversation:updated', {
      conversation: updated,
    });
    this.logger.log(`lead do site recusou o contato ("Agora não") conv=${input.conversationId}`);
  }

  private async sendText(input: WebsiteLeadInboundInput, text: string, senderName?: string) {
    const contactChannel = await this.prisma.contactChannel.findFirst({
      where: { contactId: input.contactId, channelId: input.channelId },
      select: { externalId: true },
    });
    if (!contactChannel) {
      this.logger.warn(`sem contato no canal para agradecer conv=${input.conversationId}`);
      return;
    }
    const message = await this.prisma.message.create({
      data: {
        conversationId: input.conversationId,
        direction: MessageDirection.OUTBOUND,
        type: MessageContentType.TEXT,
        content: { text },
        status: MessageStatus.QUEUED,
        senderName: senderName ?? 'Atendimento',
        metadata: { source: 'website_lead_decline' },
      },
    });
    this.realtime.emitToChannel(input.channelId, 'message:new', {
      message,
      conversationId: input.conversationId,
      contactId: input.contactId,
    });
    this.realtime.emitToConversation(input.conversationId, 'message:new', { message });
    await this.outboundQueue.add(
      'send-outbound',
      {
        messageId: message.id,
        channelId: input.channelId,
        contactExternalId: contactChannel.externalId,
        message: { type: MessageContentType.TEXT, content: { text } },
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true, removeOnFail: false },
    );
  }

  /** Quem preencheu o site e depois chamou no WhatsApp: conversa de origem "Site". */
  private async tagIfRecentSiteLead(input: WebsiteLeadInboundInput): Promise<void> {
    const recent = await this.prisma.leadSubmission.findFirst({
      where: {
        organizationId: input.organizationId,
        contactId: input.contactId,
        createdAt: { gte: new Date(Date.now() - SITE_ORIGIN_WINDOW_MS) },
      },
      orderBy: { createdAt: 'desc' },
      select: { formKind: true },
    });
    if (!recent) return;
    const tags = recent.formKind === 'guiamento' ? [SITE_TAG, GUIAMENTO_TAG] : [SITE_TAG];
    await tagConversation(this.prisma, input.organizationId, input.conversationId, tags);
  }
}
