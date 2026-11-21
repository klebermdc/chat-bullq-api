import { Prisma, PrismaClient } from '@prisma/client';
import { emailsMatch, phoneDigits, phonesMatch } from './reconciliation.match';

/**
 * Contatos da org que batem com o e-mail (exato, sem caixa) ou o telefone
 * (últimos 8 dígitos — mesmo critério de `phonesMatch`) de um pedido do Hub.
 */

const PHONE_TAIL_DIGITS = 8;
const MAX_CONTACTS = 20;

export interface MatchedContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface ContactKeys {
  email: string | null;
  phoneTail: string | null;
  rawPhone: string | null;
}

export function contactKeys(email?: string | null, phone?: string | null): ContactKeys {
  const normalizedEmail = (email ?? '').trim().toLowerCase() || null;
  const digits = phoneDigits(phone);
  const phoneTail = digits.length >= PHONE_TAIL_DIGITS ? digits.slice(-PHONE_TAIL_DIGITS) : null;
  return { email: normalizedEmail, phoneTail, rawPhone: phoneTail ? digits : null };
}

export const hasContactKeys = (keys: ContactKeys) => !!keys.email || !!keys.phoneTail;

/** Ordena quem casa por e-mail E telefone primeiro (mais confiável). */
function strength(contact: MatchedContact, keys: ContactKeys): number {
  const byEmail = keys.email ? emailsMatch(contact.email, keys.email) : false;
  const byPhone = keys.rawPhone ? phonesMatch(contact.phone, keys.rawPhone) : false;
  return Number(byEmail) + Number(byPhone);
}

type RawQuery = Pick<PrismaClient, '$queryRaw'>;

export async function findContactsByKeys(
  db: RawQuery,
  organizationId: string,
  keys: ContactKeys,
): Promise<MatchedContact[]> {
  if (!hasContactKeys(keys)) return [];
  // Valores sempre parametrizados; org sempre no WHERE (isolamento).
  const rows = await db.$queryRaw<MatchedContact[]>(Prisma.sql`
    SELECT c."id", c."name", c."email", c."phone"
    FROM "contacts" c
    WHERE c."organization_id" = ${organizationId}
      AND c."deleted_at" IS NULL
      AND (
        -- 8 = PHONE_TAIL_DIGITS (literal: right() não aceita bigint parametrizado)
        (${keys.phoneTail}::text IS NOT NULL
          AND right(regexp_replace(COALESCE(c."phone", ''), '[^0-9]', '', 'g'), 8) = ${keys.phoneTail})
        OR (${keys.email}::text IS NOT NULL
          AND lower(TRIM(BOTH FROM COALESCE(c."email", ''))) = ${keys.email})
      )
    ORDER BY c."updated_at" DESC
    LIMIT ${MAX_CONTACTS}
  `);
  return rows
    .map((contact, index) => ({ contact, index, score: strength(contact, keys) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.contact);
}
