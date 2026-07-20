import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MessageDirection } from '@prisma/client';

/**
 * Lê as últimas N mensagens INBOUND (do cliente) de uma conversa, em ordem
 * cronológica, extraindo só o texto (`content.text`). Usado pelo orquestrador
 * pra dar contexto ao extrator sem depender de uma única mensagem isolada.
 */
@Injectable()
export class ConversationMessagesReader {
  constructor(private readonly prisma: PrismaService) {}

  async recentCustomerTexts(conversationId: string, limit: number): Promise<string[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, direction: MessageDirection.INBOUND },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { content: true },
    });
    return rows
      .map((r) => (r.content as any)?.text)
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .reverse();
  }
}
