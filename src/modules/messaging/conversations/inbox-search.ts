import { Prisma } from '@prisma/client';

/**
 * Teto de contatos que a busca da inbox considera. Termo bem específico
 * (nome, telefone) casa poucos; o teto só protege contra termo genérico ("a").
 */
export const SEARCH_CONTACT_LIMIT = 2000;

/**
 * Cláusulas OR da busca do inbox: conversa de um contato que casou a busca
 * de contatos (nome sem acento, palavra por palavra, telefone em qualquer
 * máscara, e-mail — ver contacts/contact-search.ts) ou protocolo.
 */
export function buildSearchOr(
  term: string,
  contactIds: readonly string[],
): Prisma.ConversationWhereInput[] {
  const trimmed = (term || '').trim();
  if (!trimmed) return [];
  return [
    ...(contactIds.length > 0 ? [{ contactId: { in: [...contactIds] } }] : []),
    { protocol: { contains: trimmed, mode: 'insensitive' } },
  ];
}
