import { Prisma } from '@prisma/client';

/**
 * Mínimo de dígitos para o termo virar busca por telefone. Abaixo disso o
 * `contains` casaria com boa parte do banco e afogaria o resultado textual.
 */
export const MIN_PHONE_DIGITS = 3;

/**
 * Cláusulas OR da busca do inbox: nome do contato, protocolo e telefone.
 *
 * O telefone é gravado só em dígitos (`normalizePhone` → "5511982015967"), então
 * casar o termo cru falha em qualquer máscara: "(11) 98201-5967" nunca achava o
 * lead. Por isso o termo é reduzido a dígitos antes de comparar.
 */
export function buildSearchOr(term: string): Prisma.ConversationWhereInput[] {
  const trimmed = (term || '').trim();
  if (!trimmed) return [];

  const digits = trimmed.replace(/\D/g, '');
  const clauses: Prisma.ConversationWhereInput[] = [
    { contact: { name: { contains: trimmed, mode: 'insensitive' } } },
    { protocol: { contains: trimmed, mode: 'insensitive' } },
  ];

  if (digits.length >= MIN_PHONE_DIGITS) {
    clauses.push({ contact: { phone: { contains: digits } } });
  }

  return clauses;
}
