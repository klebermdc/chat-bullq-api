import { Injectable } from '@nestjs/common';
import { AcceptanceKind, MessageContentType, MessageDirection, MessageStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class AcceptanceEffectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async onSigned(acc: {
    id: string;
    organizationId: string;
    conversationId: string;
    cardId: string | null;
    signerName: string;
    signedAt: Date;
    /** Ausente = DELIVERY. CONTRACT não mexe no card (não é entrega). */
    kind?: AcceptanceKind;
    title?: string | null;
  }): Promise<void> {
    const isContract = acc.kind === AcceptanceKind.CONTRACT;
    const conv = await this.prisma.conversation.findUnique({
      where: { id: acc.conversationId },
      select: { id: true, channelId: true, contactId: true },
    });
    if (!conv) return;

    const when = acc.signedAt.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    });
    // Aviso no thread vale para os dois; o texto diz o que foi assinado.
    const text = isContract
      ? `✅ Cliente assinou o contrato ${acc.title ? `*${acc.title}* ` : ''}— ${acc.signerName} em ${when}`
      : `✅ Cliente confirmou o recebimento — ${acc.signerName} em ${when}`;

    const systemMessage = await this.prisma.message.create({
      data: {
        conversationId: acc.conversationId,
        direction: MessageDirection.OUTBOUND,
        type: MessageContentType.SYSTEM,
        status: MessageStatus.SENT,
        sentAt: new Date(),
        content: {
          text,
          acceptance: { id: acc.id, status: 'SIGNED', kind: acc.kind ?? AcceptanceKind.DELIVERY },
        },
      },
    });

    // SYSTEM message não passa pelo fluxo de send; aparece no thread na hora.
    this.realtime.emitToChannel(conv.channelId, 'message:new', {
      message: systemMessage,
      conversationId: conv.id,
      contactId: conv.contactId,
    });
    this.realtime.emitToConversation(conv.id, 'message:new', {
      message: systemMessage,
    });

    // Selo de entrega no card é efeito SÓ do aceite de entrega: um contrato
    // assinado não pode marcar o pedido como recebido.
    if (acc.cardId && !isContract) {
      const existing = await this.prisma.card.findUnique({
        where: { id: acc.cardId },
        select: { metadata: true },
      });
      const metadata = {
        ...((existing?.metadata as Record<string, any>) ?? {}),
        acceptance: { status: 'SIGNED', signedAt: acc.signedAt.toISOString() },
      };
      const card = await this.prisma.card.update({
        where: { id: acc.cardId },
        data: { metadata: metadata as any },
      });
      this.realtime.emitToOrg(acc.organizationId, 'card:updated', { card });
    }
  }
}
