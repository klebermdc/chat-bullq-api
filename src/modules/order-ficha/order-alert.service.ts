import { Injectable } from '@nestjs/common';
import { MessageContentType, MessageDirection, MessageStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { Divergence } from './order-ficha.types';

/**
 * Alerta de divergência no pedido: quando o cruzamento entre a Ficha (o que o
 * cliente pediu na conversa) e o carrinho enviado ao HUB acusa diferença,
 * posta uma mensagem SYSTEM no thread e marca a conversa
 * (`hasOrderDivergence`) para o selo aparecer no inbox.
 *
 * Dedup: não reposta o mesmo alerta se o ÚLTIMO SYSTEM message da conversa já
 * for esse exato aviso (evita spam quando o mesmo carrinho é reenviado sem
 * mudanças).
 */
@Injectable()
export class OrderAlertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async raise(conversationId: string, channelId: string, divergences: Divergence[]): Promise<void> {
    if (!divergences.length) return;

    const text =
      '⚠️ Divergência no pedido:\n' + divergences.map((d) => `• ${d.message}`).join('\n');

    const last = await this.prisma.message.findFirst({
      where: { conversationId, type: MessageContentType.SYSTEM },
      orderBy: { createdAt: 'desc' },
    });
    const lastContent = (last?.content as any) ?? null;
    if (lastContent?.orderDivergence === true && lastContent.text === text) {
      return;
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        direction: MessageDirection.OUTBOUND,
        type: MessageContentType.SYSTEM,
        status: MessageStatus.SENT,
        sentAt: new Date(),
        content: { text, orderDivergence: true, divergences: divergences as any },
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { hasOrderDivergence: true },
    });

    this.realtime.emitToConversation(conversationId, 'message:new', { message });
    if (channelId) {
      this.realtime.emitToChannel(channelId, 'message:new', { conversationId, message });
    }
  }
}
