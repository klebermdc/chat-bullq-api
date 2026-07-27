import { Injectable } from '@nestjs/common';
import { MessageContentType, MessageDirection, MessageStatus } from '@prisma/client';
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
  }): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: acc.conversationId },
      select: { id: true, channelId: true, contactId: true },
    });
    if (!conv) return;

    const when = acc.signedAt.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    });
    const text = `✅ Cliente confirmou o recebimento — ${acc.signerName} em ${when}`;

    const systemMessage = await this.prisma.message.create({
      data: {
        conversationId: acc.conversationId,
        direction: MessageDirection.OUTBOUND,
        type: MessageContentType.SYSTEM,
        status: MessageStatus.SENT,
        sentAt: new Date(),
        content: { text, acceptance: { id: acc.id, status: 'SIGNED' } },
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

    if (acc.cardId) {
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
