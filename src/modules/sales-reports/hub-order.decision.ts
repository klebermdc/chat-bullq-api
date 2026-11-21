/**
 * Pedido salvo no OFP Hub → card do funil do Sendtur.
 *
 * Funções puras (sem I/O): escolhem o card de um contato pra consulta do Hub
 * (`pickLookupCard`) e decidem o que fazer quando o Hub avisa que o pedido foi
 * fechado (`decideOrderWon`). O serviço só busca os dados e aplica a decisão.
 */
import { orderNumberCandidates } from './order-number';
import { matchVendedorByName } from './vendedor-match';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Ganho marcado à mão até N dias antes/depois do pedido conta como o mesmo negócio. */
export const WON_MATCH_WINDOW_DAYS = 7;
/** Consulta do Hub: Ganho recente sem pedido ligado ainda serve de card. */
export const LOOKUP_WON_LOOKBACK_DAYS = 45;
const VALUE_TOLERANCE = 0.01;

export interface HubCard {
  id: string;
  status: 'OPEN' | 'WON' | 'LOST';
  value: number | null;
  closedAt: Date | null;
  updatedAt: Date;
  /** `metadata.orderNumber` — nº digitado pelo vendedor ao dar Ganho. */
  orderNumber: string | null;
  /** `metadata.ofpOrderExternalId` — pedido do Hub já ligado ao card. */
  ofpOrderExternalId: string | null;
  /** Nome do vendedor do card (dono do card ou da conversa). */
  sellerName: string | null;
}

export interface HubOrderFacts {
  pedido: string | null;
  venda: number | null;
  vendedor: string | null;
  data: Date;
}

export type OrderWonDecision =
  | { result: 'won'; card: HubCard; candidates: number }
  | { result: 'linked_existing'; card: HubCard; candidates: number }
  | { result: 'no_card'; candidates: 0 }
  | { result: 'ambiguous'; candidates: number };

const isLinked = (card: HubCard) => !!card.ofpOrderExternalId;
const byNewest = (key: (c: HubCard) => number) => (a: HubCard, b: HubCard) => key(b) - key(a);

function withinDays(date: Date | null, ref: Date, days: number): boolean {
  if (!date) return false;
  return Math.abs(date.getTime() - ref.getTime()) <= days * DAY_MS;
}

/**
 * Card a mostrar na consulta do Hub: o OPEN mais recente; sem OPEN, o Ganho
 * mais recente dos últimos 45 dias que ainda não tem pedido ligado.
 */
export function pickLookupCard(cards: readonly HubCard[], now: Date): HubCard | null {
  const open = cards.filter((c) => c.status === 'OPEN').sort(byNewest((c) => c.updatedAt.getTime()));
  if (open.length > 0) return open[0];
  const since = now.getTime() - LOOKUP_WON_LOOKBACK_DAYS * DAY_MS;
  const won = cards
    .filter((c) => c.status === 'WON' && !isLinked(c) && !!c.closedAt && c.closedAt.getTime() >= since)
    .sort(byNewest((c) => (c.closedAt as Date).getTime()));
  return won[0] ?? null;
}

/**
 * Candidatos a receber o pedido: OPEN sem pedido ligado + Ganho em ±7 dias da
 * data do pedido sem pedido ligado (vendedor que já marcou Ganho à mão).
 * Card com pedido ligado nunca é candidato: sobrescrever somaria em dobro.
 */
export function wonCandidates(cards: readonly HubCard[], orderDate: Date): HubCard[] {
  return cards.filter((c) => {
    if (isLinked(c)) return false;
    if (c.status === 'OPEN') return true;
    return c.status === 'WON' && withinDays(c.closedAt, orderDate, WON_MATCH_WINDOW_DAYS);
  });
}

function orderNumberMatches(card: HubCard, pedido: string | null): boolean {
  const target = (pedido ?? '').trim().toUpperCase();
  if (!target) return false;
  return orderNumberCandidates(card.orderNumber).some((c) => c.toUpperCase() === target);
}

function valueMatches(card: HubCard, venda: number | null): boolean {
  if (venda == null || card.value == null) return false;
  return Math.abs(card.value - venda) < VALUE_TOLERANCE;
}

function sellerMatches(card: HubCard, vendedor: string | null): boolean {
  if (!vendedor) return false;
  return matchVendedorByName(card.sellerName, [vendedor]) !== null;
}

/**
 * Desempate por sinais, do mais forte pro mais fraco: nº do pedido, valor,
 * vendedor. Cada sinal que casa com alguém estreita o grupo; sobrar um só = esse.
 */
function breakTie(cards: readonly HubCard[], order: HubOrderFacts): HubCard | null {
  const signals: Array<(c: HubCard) => boolean> = [
    (c) => orderNumberMatches(c, order.pedido),
    (c) => valueMatches(c, order.venda),
    (c) => sellerMatches(c, order.vendedor),
  ];
  const remaining = signals.reduce<readonly HubCard[]>((group, signal) => {
    if (group.length <= 1) return group;
    const hits = group.filter(signal);
    return hits.length > 0 ? hits : group;
  }, cards);
  return remaining.length === 1 ? remaining[0] : null;
}

function resultFor(card: HubCard, candidates: number): OrderWonDecision {
  return card.status === 'OPEN'
    ? { result: 'won', card, candidates }
    : { result: 'linked_existing', card, candidates };
}

export function decideOrderWon(cards: readonly HubCard[], order: HubOrderFacts): OrderWonDecision {
  const candidates = wonCandidates(cards, order.data);
  if (candidates.length === 0) return { result: 'no_card', candidates: 0 };
  if (candidates.length === 1) return resultFor(candidates[0], 1);
  const picked = breakTie(candidates, order);
  return picked ? resultFor(picked, candidates.length) : { result: 'ambiguous', candidates: candidates.length };
}
