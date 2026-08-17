import { Injectable, Logger } from '@nestjs/common';
import { MessageContentType, MessageStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { computeWhatsappWindow } from '../conversations/whatsapp-window.util';

const BLOCK_REASON_WHATSAPP =
  'Janela de atendimento (24h/72h) fechada — envie um template aprovado.';
const BLOCK_REASON_MESSENGER =
  'Janela de atendimento do Messenger (24h) fechada — a Meta nao permite ' +
  'enviar fora dela. Aguarde o cliente responder.';

// Vale nos canais da Meta que tem janela de atendimento: WhatsApp oficial
// (24h/72h) e Messenger (24h fixas).
const GATED_CHANNELS = ['WHATSAPP_OFFICIAL', 'MESSENGER'];

@Injectable()
export class MetaWindowGate {
  private readonly logger = new Logger(MetaWindowGate.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Backstop: se um envio de TEXTO LIVRE cai fora da janela num canal oficial,
   * marca a mensagem como FAILED com motivo claro e retorna true (o chamador
   * NÃO deve enviar nem re-tentar). Template / canal não-oficial / janela
   * aberta ⇒ retorna false (segue o fluxo normal).
   */
  async blockIfClosed(params: {
    messageId: string;
    channelType: string;
    messageType: MessageContentType;
    now?: Date;
  }): Promise<boolean> {
    // Template é o único permitido fora da janela — nunca gateia.
    if (params.messageType === MessageContentType.TEMPLATE) return false;
    if (!GATED_CHANNELS.includes(params.channelType)) return false;

    try {
      const msg = await this.prisma.message.findUnique({
        where: { id: params.messageId },
        select: {
          conversationId: true,
          conversation: {
            select: {
              lastInboundAt: true,
              metaWindowExpiresAt: true,
              contact: { select: { ctwaClidAt: true } },
            },
          },
        },
      });
      if (!msg?.conversation) return false; // sem contexto → não arrisca bloquear

      const window = computeWhatsappWindow({
        channelType: params.channelType,
        lastInboundAt: msg.conversation.lastInboundAt ?? null,
        ctwaClidAt: msg.conversation.contact?.ctwaClidAt ?? null,
        metaWindowExpiresAt: msg.conversation.metaWindowExpiresAt ?? null,
        now: params.now ?? new Date(),
      });
      if (window.open) return false;

      const failedReason =
        params.channelType === 'MESSENGER'
          ? BLOCK_REASON_MESSENGER
          : BLOCK_REASON_WHATSAPP;
      const updated = await this.prisma.message.update({
        where: { id: params.messageId },
        data: { status: MessageStatus.FAILED, failedReason },
        select: { id: true, conversationId: true },
      });
      this.realtime.emitToConversation(updated.conversationId, 'message:status', {
        messageId: updated.id,
        status: MessageStatus.FAILED,
        conversationId: updated.conversationId,
      });
      this.logger.warn(
        `outbound_window_closed msg=${params.messageId} type=${params.messageType}`,
      );
      return true;
    } catch (err) {
      // Fail-open: um erro inesperado (ex.: pool exhaustion) NUNCA deve
      // propagar daqui — o chamador roda isto antes do próprio try/catch.
      // Preferimos deixar o envio seguir (mesmo risco de qualquer envio
      // normal) a derrubar a mensagem sem status/motivo.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `outbound_window_gate_error msg=${params.messageId} error=${message}`,
      );
      return false;
    }
  }
}
