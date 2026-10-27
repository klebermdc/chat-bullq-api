import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { ExtractedCart } from '../proposals.types';
import {
  HOUR_MS,
  QUOTE_CUSTOMER_NAME_MAX,
  QUOTE_DEFAULT_VALIDITY_HOURS,
  QUOTE_FALLBACK_PATH,
  QUOTE_TOKEN_BYTES,
} from './quote.constants';
import type { QuoteData, QuoteInstallments, QuoteItem } from './quote.types';

type Env = Readonly<Record<string, string | undefined>>;

/** Entrada já validada pelo DTO; campos anuláveis podem vir ausentes. */
type QuoteItemInput = Omit<QuoteItem, 'startDate' | 'endDate' | 'description' | 'priceAdult' | 'priceChild' | 'cancellationPolicy'> &
  Partial<Pick<QuoteItem, 'startDate' | 'endDate' | 'description' | 'priceAdult' | 'priceChild' | 'cancellationPolicy'>>;
export interface QuoteInput {
  items: readonly QuoteItemInput[];
  currency: string;
  total: number;
  pixTotal?: number | null;
  installments?: QuoteInstallments | null;
  notes?: string | null;
}

const PHONE_LIKE_RE = /^[\d\s()+.-]+$/;

export function newQuoteToken(): string {
  return randomBytes(QUOTE_TOKEN_BYTES).toString('base64url');
}

export function quoteExpiresAt(now: Date, hours: number = QUOTE_DEFAULT_VALIDITY_HOURS): Date {
  return new Date(now.getTime() + hours * HOUR_MS);
}

const trimSlashes = (url: string) => url.trim().replace(/\/+$/, '');

/** Base da página pública: `QUOTE_PUBLIC_URL` ou `${APP_PUBLIC_URL}/cotacao`. */
export function quotePublicBaseUrl(env: Env = process.env): string | null {
  const own = trimSlashes(env.QUOTE_PUBLIC_URL ?? '');
  if (own) return own;
  const app = trimSlashes(env.APP_PUBLIC_URL ?? '');
  return app ? `${app}${QUOTE_FALLBACK_PATH}` : null;
}

export function quotePublicUrl(token: string, env: Env = process.env): string | null {
  const base = quotePublicBaseUrl(env);
  return base ? `${base}/${token}` : null;
}

export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first || null;
}

/** Mensagem curta que vai no WhatsApp no lugar da proposta em texto. */
export function buildQuoteMessage(customerName: string | null, url: string): string {
  const name = firstName(customerName);
  const greeting = name ? `Oi, ${name}!` : 'Oi!';
  return (
    `${greeting} Sua cotação ficou pronta. Toque no link para ver tudo com calma, ` +
    `e qualquer dúvida é só me chamar aqui.\n\n${url}`
  );
}

/** Nome do contato como sugestão no preview; telefone salvo como nome não serve. */
export function contactDisplayName(name: string | null | undefined): string | null {
  const clean = (name ?? '').trim();
  if (!clean || PHONE_LIKE_RE.test(clean)) return null;
  return clean.slice(0, QUOTE_CUSTOMER_NAME_MAX);
}

const textOrNull = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t ? t : null;
};

function normalizeItem(item: QuoteItemInput, index: number): QuoteItem {
  const title = item.title.trim();
  if (!title) throw new BadRequestException(`Informe o título do item ${index + 1}.`);
  const start = item.startDate ?? item.endDate ?? null;
  const end = item.endDate ?? item.startDate ?? null;
  if (start && end && end < start) {
    throw new BadRequestException(`No item ${index + 1}, a data final está antes da inicial.`);
  }
  return {
    provider: item.provider.trim(),
    title,
    startDate: start,
    endDate: end,
    description: textOrNull(item.description),
    adults: item.adults,
    children: item.children,
    priceAdult: item.priceAdult ?? null,
    priceChild: item.priceChild ?? null,
    total: item.total,
    cancellationPolicy: textOrNull(item.cancellationPolicy),
  };
}

/**
 * A cotação conferida pelo atendente no formato gravado: campos anuláveis
 * sempre presentes, textos aparados. Formato e limites já vêm do DTO; aqui só
 * o que cruza campos (datas) e o que o DTO não pega (título só de espaços).
 */
export function normalizeQuote(input: QuoteInput): QuoteData {
  return {
    items: input.items.map(normalizeItem),
    currency: input.currency,
    total: input.total,
    pixTotal: input.pixTotal ?? null,
    installments: input.installments
      ? { count: input.installments.count, value: input.installments.value }
      : null,
    notes: textOrNull(input.notes),
  };
}

/**
 * Colunas de ingresso da tabela a partir da cotação: pessoas = máximo dos
 * itens, datas = menor início e maior fim. Sem data nenhuma, o momento do
 * envio (como a proposta OTHER).
 */
export function quoteCart(quote: QuoteData, now: Date): ExtractedCart {
  const starts = quote.items.map((i) => i.startDate).filter((d): d is string => !!d).sort();
  const ends = quote.items.map((i) => i.endDate).filter((d): d is string => !!d).sort();
  const fallback = now.toISOString();
  return {
    adults: Math.max(...quote.items.map((i) => i.adults)),
    children: Math.max(...quote.items.map((i) => i.children)),
    startDate: starts[0] ?? fallback,
    endDate: ends[ends.length - 1] ?? fallback,
    parks: [],
    totalValue: quote.total,
    currency: quote.currency,
  };
}
