import { Injectable, Logger } from '@nestjs/common';
import { MessageContentType, MessageStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { computeWhatsappWindow } from '../conversations/whatsapp-window.util';

const BLOCK_REASON =
  'Janela de atendimento (24h/72h) fechada — envie um template aprovado.';

@Injectable()
export class WhatsappWindowGate {
  private readonly logger = new Logger(WhatsappWindowGate.name);

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
    // Regra só existe no canal oficial da Meta.
    if (params.channelType !== 'WHATSAPP_OFFICIAL') return false;

    const msg = await this.prisma.message.findUnique({
      where: { id: params.messageId },
      select: {
        conversationId: true,
        conversation: {
          select: {
            lastInboundAt: true,
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
      now: params.now ?? new Date(),
    });
    if (window.open) return false;

    const updated = await this.prisma.message.update({
      where: { id: params.messageId },
      data: { status: MessageStatus.FAILED, failedReason: BLOCK_REASON },
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
  }
}
