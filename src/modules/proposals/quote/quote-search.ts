import { Prisma } from '@prisma/client';
import { QUOTE_KIND } from './quote.constants';

export const QUOTE_SEARCH_MAX = 100;
export const QUOTE_STATUS_FILTERS = ['ACTIVE', 'VIEWED', 'NOT_VIEWED', 'EXPIRED'] as const;
export type QuoteStatusFilter = (typeof QUOTE_STATUS_FILTERS)[number];

/** Acima disso não cabe na coluna inteira: só pode ser telefone. */
const MAX_NUMBER_DIGITS = 9;
const MIN_PHONE_DIGITS = 3;
/** "#152", "nº 0152", "COT-152", "cotação 152". */
const NUMBER_PREFIXED = /^(?:cot(?:a[cç][aã]o)?[\s-]*)?(?:n[º°o.]*\s*|#\s*)?(\d+)$/i;
const PHONE_LIKE = /^[\d\s()+.-]+$/;

export interface QuoteSearch {
  quoteNumber: number | null;
  phoneDigits: string | null;
  likePattern: string | null;
}

export interface QuoteSearchFilter {
  organizationId: string;
  search: QuoteSearch | null;
  status?: QuoteStatusFilter;
  sellerId?: string;
  /** AGENT: só cotações das conversas atribuídas a ele. */
  assignedToId?: string;
  now: Date;
}

const toNumber = (digits: string): number | null => {
  const clean = digits.replace(/^0+(?=\d)/, '');
  return clean.length <= MAX_NUMBER_DIGITS && Number(clean) > 0 ? Number(clean) : null;
};

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, '\\$&');

/** Entende o que o atendente digitou: número da cotação, telefone ou texto. */
export function parseQuoteSearch(raw: string | undefined): QuoteSearch | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const numbered = NUMBER_PREFIXED.exec(text);
  if (numbered && !/^\d+$/.test(text)) {
    return { quoteNumber: toNumber(numbered[1]), phoneDigits: null, likePattern: null };
  }
  if (PHONE_LIKE.test(text)) {
    const digits = text.replace(/\D/g, '');
    return {
      quoteNumber: /^\d+$/.test(text) ? toNumber(digits) : null,
      phoneDigits: digits.length >= MIN_PHONE_DIGITS ? digits : null,
      likePattern: null,
    };
  }
  return { quoteNumber: null, phoneDigits: null, likePattern: `%${escapeLike(text)}%` };
}

const quoteItems = Prisma.sql`jsonb_array_elements(
  CASE WHEN jsonb_typeof(p.details->'quote'->'items') = 'array' THEN p.details->'quote'->'items' ELSE '[]'::jsonb END
)`;

function textCondition(pattern: string): Prisma.Sql {
  return Prisma.sql`(
    c.name ILIKE ${pattern}
    OR p.details->>'customerName' ILIKE ${pattern}
    OR EXISTS (
      SELECT 1 FROM ${quoteItems} AS item
      WHERE item->>'hotelName' ILIKE ${pattern}
        OR item->'hotel'->>'name' ILIKE ${pattern}
        OR item->>'title' ILIKE ${pattern}
        OR item->>'provider' ILIKE ${pattern}
    )
  )`;
}

function searchCondition(search: QuoteSearch): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (search.quoteNumber !== null) parts.push(Prisma.sql`p.quote_number = ${search.quoteNumber}`);
  if (search.phoneDigits) {
    parts.push(Prisma.sql`regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') LIKE ${`%${search.phoneDigits}%`}`);
  }
  if (search.likePattern) parts.push(textCondition(search.likePattern));
  // "#0" ou número fora do limite: nada casa, em vez de listar tudo.
  return parts.length > 0 ? Prisma.sql`(${Prisma.join(parts, ' OR ')})` : Prisma.sql`FALSE`;
}

function statusCondition(status: QuoteStatusFilter, now: Date): Prisma.Sql {
  switch (status) {
    case 'ACTIVE':
      return Prisma.sql`p.expires_at > ${now}`;
    case 'EXPIRED':
      return Prisma.sql`(p.expires_at IS NULL OR p.expires_at <= ${now})`;
    case 'VIEWED':
      return Prisma.sql`p.view_count > 0`;
    case 'NOT_VIEWED':
      return Prisma.sql`p.view_count = 0`;
  }
}

/** Condição da busca, sempre presa à organização e às cotações por link. */
export function quoteSearchWhere(filter: QuoteSearchFilter): Prisma.Sql {
  const parts = [
    Prisma.sql`p.organization_id = ${filter.organizationId}`,
    Prisma.sql`p.kind = ${QUOTE_KIND}`,
    Prisma.sql`p.public_token IS NOT NULL`,
  ];
  if (filter.search) parts.push(searchCondition(filter.search));
  if (filter.status) parts.push(statusCondition(filter.status, filter.now));
  if (filter.sellerId) parts.push(Prisma.sql`p.created_by_id = ${filter.sellerId}`);
  if (filter.assignedToId) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM conversations v WHERE v.id = p.conversation_id AND v.assigned_to_id = ${filter.assignedToId}
    )`);
  }
  return Prisma.join(parts, ' AND ');
}

/** O número exato vem antes dos telefones que por acaso contêm os mesmos dígitos. */
export function quoteSearchOrder(search: QuoteSearch | null): Prisma.Sql {
  return search?.quoteNumber
    ? Prisma.sql`(p.quote_number = ${search.quoteNumber}) DESC NULLS LAST, p.created_at DESC`
    : Prisma.sql`p.created_at DESC`;
}
