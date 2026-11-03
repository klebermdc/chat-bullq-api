import { MessageDirection } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { customerTextOf } from '../emergency/emergency-contact.util';

/** Janela das mensagens do cliente onde a Aline busca as provas. */
const EVIDENCE_WINDOW_MS = 48 * 3600_000;
const MAX_CUSTOMER_MESSAGES = 50;

/**
 * O que o cliente escreveu (texto, legenda ou áudio transcrito) nas últimas
 * 48h. As ferramentas conferem aqui as frases que a Aline cita como prova.
 */
export async function loadRecentCustomerTexts(
  prisma: PrismaService,
  conversationId: string,
  now: Date,
): Promise<string[]> {
  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      direction: MessageDirection.INBOUND,
      createdAt: { gte: new Date(now.getTime() - EVIDENCE_WINDOW_MS) },
    },
    select: { content: true, metadata: true },
    orderBy: { createdAt: 'desc' },
    take: MAX_CUSTOMER_MESSAGES,
  });
  return messages.map(customerTextOf).filter(Boolean);
}
