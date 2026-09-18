import type { PrismaClient } from '@prisma/client';
import type { ReplyContext } from '../../channel-hub/ports/types';

const MAX_PREVIEW_CHARS = 160;

/** Prévia de uma mensagem citada — mesma regra do "Responder" do atendente. */
export function buildQuotePreview(original: { type: string; content: unknown }): string {
  const c = (original.content ?? {}) as Record<string, any>;
  const text =
    (typeof c.text === 'string' && c.text) ||
    (typeof c.caption === 'string' && c.caption) ||
    `[${original.type.toLowerCase()}]`;
  return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS - 1)}…` : text;
}

type ReplyLookupClient = Pick<PrismaClient, 'conversation' | 'message'>;

/**
 * Completa a citação de uma mensagem do cliente com a original do nosso banco
 * (prévia, quem escreveu, id interno pra rolar até ela). Sem isso só o id do
 * provedor era gravado e o inbox não mostrava o que o cliente citou.
 *
 * Procura em todas as conversas do contato naquele canal: a cotação citada
 * pode ser de um atendimento anterior. Não achou → devolve o que veio do
 * provedor (o Zappfy já manda a prévia; a Meta não).
 */
export async function resolveInboundReplyTo(
  prisma: ReplyLookupClient,
  conversationId: string,
  replyTo: ReplyContext | undefined,
): Promise<ReplyContext | undefined> {
  if (!replyTo?.externalMessageId) return replyTo;

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { contactId: true, channelId: true, contact: { select: { name: true } } },
  });
  if (!conversation) return replyTo;

  const original = await prisma.message.findFirst({
    where: {
      externalId: replyTo.externalMessageId,
      conversation: { contactId: conversation.contactId, channelId: conversation.channelId },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, type: true, content: true, direction: true, senderName: true,
      sender: { select: { name: true } },
    },
  });
  if (!original) return replyTo;

  const fromMe = original.direction === 'OUTBOUND';
  const senderName = fromMe
    ? (original.sender?.name ?? original.senderName ?? undefined)
    : (original.senderName ?? conversation.contact?.name ?? undefined);

  return {
    ...replyTo,
    messageId: original.id,
    previewText: buildQuotePreview(original),
    senderName,
    fromMe,
  };
}
