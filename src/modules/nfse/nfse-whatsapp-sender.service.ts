import { Injectable, Logger } from '@nestjs/common';
import { Channel, MessageContentType, MessageDirection, MessageStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ChannelAdapterRegistry } from '../channel-hub/channel-adapter.registry';
import type { NormalizedOutboundMessage } from '../channel-hub/ports/types';
import { IdempotencyService } from '../messaging/pipeline/idempotency.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const SENDER_NAME = 'Atendimento';
const MAX_REASON = 500;

/** O WhatsApp recusou o envio (número inválido, canal desconectado, template...). */
export class NfseDeliveryError extends Error {}

export interface NfseOutbound {
  channel: Channel;
  conversationId: string;
  contactExternalId: string;
  type: MessageContentType;
  content: Prisma.InputJsonValue;
  metadata: Prisma.InputJsonObject;
}

/**
 * Envia uma mensagem na hora (sem a fila de saída) e grava no histórico da
 * conversa. A fila responderia "enfileirado" antes da Meta recusar; o Hub
 * precisa do resultado real para saber se a nota chegou.
 */
@Injectable()
export class NfseWhatsappSender {
  private readonly logger = new Logger(NfseWhatsappSender.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: ChannelAdapterRegistry,
    private readonly idempotency: IdempotencyService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async send(out: NfseOutbound): Promise<{ messageId: string; externalId: string }> {
    const message = await this.prisma.message.create({
      data: {
        conversationId: out.conversationId,
        direction: MessageDirection.OUTBOUND,
        type: out.type,
        content: out.content,
        status: MessageStatus.QUEUED,
        senderName: SENDER_NAME,
        metadata: out.metadata,
      },
    });

    let externalId: string;
    try {
      const adapter = this.adapters.getOutbound(out.channel.type);
      const result = await adapter.sendMessage(out.channel, out.contactExternalId, {
        type: out.type,
        content: out.content,
      } as unknown as NormalizedOutboundMessage);
      externalId = result.externalId || '';
    } catch (err) {
      const reason = (err instanceof Error ? err.message : String(err)).slice(0, MAX_REASON);
      await this.markFailed(message.id, out.conversationId, reason);
      throw new NfseDeliveryError(reason || 'O WhatsApp recusou o envio.');
    }

    const sent = await this.prisma.message.update({
      where: { id: message.id },
      data: { status: MessageStatus.SENT, externalId: externalId || null, sentAt: new Date() },
    });
    if (externalId) await this.idempotency.markProcessed(externalId, out.channel.id);
    this.emitNew(out.channel.id, out.conversationId, sent);
    return { messageId: sent.id, externalId };
  }

  private async markFailed(messageId: string, conversationId: string, reason: string): Promise<void> {
    await this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.FAILED, failedReason: reason },
    });
    this.realtime.emitToConversation(conversationId, 'message:status', {
      messageId,
      status: MessageStatus.FAILED,
      conversationId,
    });
  }

  private emitNew(channelId: string, conversationId: string, message: unknown): void {
    this.realtime.emitToChannel(channelId, 'message:new', { message, conversationId });
    this.realtime.emitToConversation(conversationId, 'message:new', { message, conversationId });
  }
}
