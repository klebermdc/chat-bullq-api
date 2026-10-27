import { QUOTE_CODE_LENGTH, QUOTE_KIND } from './quote.constants';
import { quotePublicUrl } from './quote-proposal';
import type { QuoteData, QuoteInstallments, QuoteItem, QuoteStatus } from './quote.types';

type Env = Readonly<Record<string, string | undefined>>;

export function quoteCode(id: string): string {
  return id.slice(-QUOTE_CODE_LENGTH).toUpperCase();
}

export function quoteStatus(expiresAt: Date | null, now: Date): QuoteStatus {
  return expiresAt && expiresAt.getTime() > now.getTime() ? 'ACTIVE' : 'EXPIRED';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function pickItem(raw: unknown): QuoteItem {
  const i = isObject(raw) ? raw : {};
  return {
    provider: str(i.provider),
    title: str(i.title),
    startDate: strOrNull(i.startDate),
    endDate: strOrNull(i.endDate),
    description: strOrNull(i.description),
    adults: num(i.adults),
    children: num(i.children),
    priceAdult: numOrNull(i.priceAdult),
    priceChild: numOrNull(i.priceChild),
    total: num(i.total),
    cancellationPolicy: strOrNull(i.cancellationPolicy),
  };
}

function pickInstallments(raw: unknown): QuoteInstallments | null {
  if (!isObject(raw)) return null;
  const count = numOrNull(raw.count);
  const value = numOrNull(raw.value);
  return count && value ? { count, value } : null;
}

/**
 * A cotação gravada em `details.quote`, por lista branca: só os campos do
 * contrato saem na resposta pública, mesmo que o JSON guardado tenha mais.
 */
export function toPublicQuote(raw: unknown): QuoteData | null {
  if (!isObject(raw) || !Array.isArray(raw.items) || raw.items.length === 0) return null;
  return {
    items: raw.items.map(pickItem),
    currency: str(raw.currency),
    total: num(raw.total),
    pixTotal: numOrNull(raw.pixTotal),
    installments: pickInstallments(raw.installments),
    notes: strOrNull(raw.notes),
  };
}

interface ProposalRowLike {
  kind?: string | null;
  publicToken?: string | null;
  expiresAt?: Date | null;
  viewCount?: number;
  firstViewedAt?: Date | null;
  lastViewedAt?: Date | null;
}

/**
 * Proposta como sai nas listagens do painel. QUOTE ganha o link e os dados de
 * abertura; as outras saem como sempre saíram. O token cru não sai: está no link.
 */
export function presentProposal<T extends ProposalRowLike>(row: T, env: Env = process.env) {
  const { publicToken, expiresAt, viewCount, firstViewedAt, lastViewedAt, ...rest } = row;
  if (row.kind !== QUOTE_KIND || !publicToken) return rest;
  return {
    ...rest,
    quoteUrl: quotePublicUrl(publicToken, env),
    expiresAt,
    viewCount,
    firstViewedAt,
    lastViewedAt,
  };
}
