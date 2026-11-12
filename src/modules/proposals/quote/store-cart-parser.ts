import {
  QUOTE_DEFAULT_CURRENCY,
  QUOTE_MAX_AMOUNT,
  QUOTE_MAX_INSTALLMENTS,
  QUOTE_MAX_ITEMS,
  QUOTE_MAX_PEOPLE,
  QUOTE_PROVIDER_MAX,
  QUOTE_TITLE_MAX,
} from './quote.constants';
import type { QuoteData, QuoteItem } from './quote.types';

/**
 * Leitor do carrinho da loja (Just Travel, reservas.orlandofastpass.com.br) a
 * partir do texto renderizado da página. Determinístico, sem modelo: os itens
 * da cotação saem exatamente do que a loja mostra.
 *
 * Formato de cada item (depois de "Detalhes do pedido"):
 *   FORNECEDOR - TÍTULO [NN dia(s)]
 *   Pessoas
 *   N Adulto(s) [, N Criança(s)]   (pode repetir: a Disney mostra as duas formas)
 *   Data
 *   dd/mm/aaaa
 *   [Janela de uso / Utilização válida de dd/mm/aaaa até dd/mm/aaaa]
 *   R$ x            (Pix ou boleto)
 *   PIX ou boleto
 *   em 10x R$ y     (TOTAL do item em 10x, não o valor da parcela)
 */

/** Totais da loja, para o atendente comparar com o outro fornecedor. */
export interface StoreOffer {
  pixTotal: number;
  installmentsTotal: number;
  installmentsCount: number;
}

export interface StoreCart {
  quote: QuoteData;
  storeOffer: StoreOffer;
}

/** Falha de leitura do carrinho; a mensagem já é para o atendente. */
export class StoreCartParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreCartParseError';
  }
}

/**
 * O carrinho terminou de carregar. A página passa por estados: um esqueleto
 * ("Ticket Name - Category Name", "Total do pedido R$ 0,00"), intermediários
 * com preço mas ainda com "Estamos carregando os dados do carrinho" (faltam a
 * "Janela de uso" e a linha de crianças) e o final, sem esse aviso. Espera-se
 * o final: sem o aviso e com o total do pedido já parcelado ("em Nx R$ y").
 */
export const STORE_CART_READY_RE =
  /^(?![\s\S]*Estamos carregando os dados do carrinho)[\s\S]*Total do pedido\s*R\$\s*[\d.]+,\d{2}\s*em \d+x R\$\s*\d/;

const SECTION_START = 'Detalhes do pedido';
const PEOPLE_LABEL = 'Pessoas';
const DATE_LABEL = 'Data';
const PIX_LABEL = 'PIX ou boleto';
const PIX_SUBTOTAL_LABEL = 'Subtotal no pix ou boleto';
const ORDER_TOTAL_LABEL = 'Total do pedido';
const PROVIDER_SEPARATOR = ' - ';
const CENTS = 100;

const SUBTOTAL_RE = /^Subtotal\b/i;
const CARD_SUBTOTAL_RE = /^Subtotal de .+ em (\d+)x$/i;
const CARD_PRICE_RE = /^em (\d+)x (R\$\s*\S+)$/i;
const MONEY_RE = /^(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}))?$/;
const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const VALIDITY_RE = /^Utilização válida de \d{2}\/\d{2}\/\d{4} até (\d{2}\/\d{2}\/\d{4})$/i;
const PEOPLE_RE = /^(\d+) Adultos?(?:, (\d+) Crianças?)?$/i;
const CHILDREN_RE = /^(\d+) Crianças?$/i;

const NO_SECTION = 'Não encontrei o carrinho na página da loja. Confere se o link abre o carrinho certo.';
const NO_ITEMS = 'Não encontrei nenhum item no carrinho da loja.';
const NO_TOTALS = 'Não encontrei os totais do carrinho (Pix e parcelado).';
const TOO_MANY_ITEMS = `O carrinho tem mais de ${QUOTE_MAX_ITEMS} itens; a cotação aceita até ${QUOTE_MAX_ITEMS} itens.`;
const TOO_MANY_PEOPLE = `Um item do carrinho tem mais de ${QUOTE_MAX_PEOPLE} pessoas; a cotação aceita até ${QUOTE_MAX_PEOPLE}.`;
const BAD_INSTALLMENTS = `Número de parcelas fora do limite (1 a ${QUOTE_MAX_INSTALLMENTS}).`;
const BAD_AMOUNT = 'Valor do carrinho fora do esperado.';

const round2 = (n: number): number => Math.round(n * CENTS) / CENTS;

/** "R$ 5.888,19" → 5888.19; null se não for dinheiro no formato brasileiro. */
export function parseBrMoney(text: string): number | null {
  const match = MONEY_RE.exec(text.trim());
  if (!match) return null;
  const units = Number(match[1].replace(/\./g, ''));
  const cents = match[2] ? Number(match[2]) / CENTS : 0;
  return round2(units + cents);
}

function amountOrThrow(text: string | undefined): number {
  const value = text === undefined ? null : parseBrMoney(text);
  if (value === null || value <= 0 || value > QUOTE_MAX_AMOUNT) throw new StoreCartParseError(BAD_AMOUNT);
  return value;
}

function installmentsOrThrow(text: string): number {
  const count = Number(text);
  if (!Number.isInteger(count) || count < 1 || count > QUOTE_MAX_INSTALLMENTS) {
    throw new StoreCartParseError(BAD_INSTALLMENTS);
  }
  return count;
}

/** "20/12/2026" → "2026-12-20"; null se a data não existe. */
function toIsoDate(text: string | undefined): string | null {
  const match = text ? DATE_RE.exec(text) : null;
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  const iso = `${yyyy}-${mm}-${dd}`;
  return date.toISOString().startsWith(iso) ? iso : null;
}

function splitHeader(header: string): Pick<QuoteItem, 'provider' | 'title'> {
  const at = header.indexOf(PROVIDER_SEPARATOR);
  const provider = at < 0 ? '' : header.slice(0, at).trim();
  const title = at < 0 ? header : header.slice(at + PROVIDER_SEPARATOR.length).trim();
  return { provider: provider.slice(0, QUOTE_PROVIDER_MAX), title: title.slice(0, QUOTE_TITLE_MAX) };
}

/** Maior contagem entre as linhas de pessoas: a Disney pode repetir a mesma gente em duas formas. */
function readPeople(lines: string[]): { adults: number; children: number } {
  const counts = lines.flatMap((line) => {
    const people = PEOPLE_RE.exec(line);
    if (people) return [{ adults: Number(people[1]), children: Number(people[2] ?? 0) }];
    const children = CHILDREN_RE.exec(line);
    return children ? [{ adults: 0, children: Number(children[1]) }] : [];
  });
  const adults = Math.max(0, ...counts.map((c) => c.adults));
  const children = Math.max(0, ...counts.map((c) => c.children));
  if (adults > QUOTE_MAX_PEOPLE || children > QUOTE_MAX_PEOPLE) throw new StoreCartParseError(TOO_MANY_PEOPLE);
  return { adults, children };
}

/** Item lido + o preço dele no Pix (a linha logo acima de "PIX ou boleto"). */
interface ParsedItem {
  item: QuoteItem;
  pix: number | null;
}

function parseItem(block: string[]): ParsedItem {
  const [header, ...lines] = block;
  const card = lines.map((line) => CARD_PRICE_RE.exec(line)).find(Boolean);
  if (!card) throw new StoreCartParseError(`Não consegui ler o valor parcelado do item "${header}".`);
  const startDate = toIsoDate(lines[lines.indexOf(DATE_LABEL) + 1]);
  const validity = lines.map((line) => VALIDITY_RE.exec(line)).find(Boolean);
  const endDate = (validity && toIsoDate(validity[1])) || startDate;
  const pixAt = lines.indexOf(PIX_LABEL);
  const item: QuoteItem = {
    ...splitHeader(header),
    startDate,
    endDate,
    description: null,
    ...readPeople(lines),
    priceAdult: null,
    priceChild: null,
    total: amountOrThrow(card[2]),
    cancellationPolicy: null,
    hotelName: null,
    hotel: null,
  };
  return { item, pix: pixAt > 0 ? parseBrMoney(lines[pixAt - 1]) : null };
}

const endsItem = (line: string) => SUBTOTAL_RE.test(line) || line === ORDER_TOTAL_LABEL;

/**
 * Um bloco por item: começa na linha logo antes de "Pessoas" e vai até o
 * próximo item ou o primeiro subtotal/total (o que vier antes).
 */
function itemBlocks(lines: string[]): string[][] {
  const starts = lines
    .map((line, i) => (line !== PEOPLE_LABEL && lines[i + 1] === PEOPLE_LABEL ? i : -1))
    .filter((i) => i >= 0);
  return starts.map((start, n) => {
    const block = lines.slice(start, starts[n + 1] ?? lines.length);
    const end = block.findIndex(endsItem);
    return end < 0 ? block : block.slice(0, end);
  });
}

const sum = (values: number[]): number => round2(values.reduce((a, b) => a + b, 0));

/** Soma o valor da linha seguinte a cada ocorrência do rótulo; null se não houver. */
function sumAfter(lines: string[], matches: (line: string) => boolean): number | null {
  const values = lines.flatMap((line, i) => (matches(line) ? [amountOrThrow(lines[i + 1])] : []));
  return values.length > 0 ? sum(values) : null;
}

/**
 * Parcelado: o "em Nx R$ y" logo abaixo de "Total do pedido"; sem ele, a soma
 * dos "Subtotal de ... em Nx". A página varia entre as duas formas.
 */
function readCardTotal(lines: string[]): { total: number; count: number } | null {
  const orderAt = lines.indexOf(ORDER_TOTAL_LABEL);
  const orderCard =
    orderAt < 0 ? undefined : lines.slice(orderAt + 1).map((line) => CARD_PRICE_RE.exec(line)).find(Boolean);
  if (orderCard) return { total: amountOrThrow(orderCard[2]), count: installmentsOrThrow(orderCard[1]) };
  const subtotal = lines.map((line) => CARD_SUBTOTAL_RE.exec(line)).find(Boolean);
  const total = sumAfter(lines, (line) => CARD_SUBTOTAL_RE.test(line));
  return subtotal && total !== null ? { total, count: installmentsOrThrow(subtotal[1]) } : null;
}

/** Pix: "Subtotal no pix ou boleto"; sem ele, a soma do Pix de cada item. */
function readPixTotal(lines: string[], items: ParsedItem[]): number | null {
  const subtotal = sumAfter(lines, (line) => line === PIX_SUBTOTAL_LABEL);
  if (subtotal !== null) return subtotal;
  const prices = items.map((p) => p.pix);
  return prices.every((p): p is number => p !== null) ? sum(prices) : null;
}

function readTotals(lines: string[], items: ParsedItem[]): StoreOffer {
  const card = readCardTotal(lines);
  const pixTotal = readPixTotal(lines, items);
  if (!card || pixTotal === null || pixTotal <= 0 || pixTotal > QUOTE_MAX_AMOUNT) {
    throw new StoreCartParseError(NO_TOTALS);
  }
  return { pixTotal, installmentsTotal: card.total, installmentsCount: card.count };
}

/** Texto renderizado do carrinho → cotação + totais da loja. Lança StoreCartParseError. */
export function parseStoreCart(text: string): StoreCart {
  // A página usa espaço não separável ("1\u00a0Adulto"): todo espaço vira um só.
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const start = lines.indexOf(SECTION_START);
  if (start < 0) throw new StoreCartParseError(NO_SECTION);
  const body = lines.slice(start + 1);

  const blocks = itemBlocks(body);
  if (blocks.length === 0) throw new StoreCartParseError(NO_ITEMS);
  if (blocks.length > QUOTE_MAX_ITEMS) throw new StoreCartParseError(TOO_MANY_ITEMS);
  const parsed = blocks.map(parseItem);
  const storeOffer = readTotals(body, parsed);

  const quote: QuoteData = {
    items: parsed.map((p) => p.item),
    currency: QUOTE_DEFAULT_CURRENCY,
    total: storeOffer.installmentsTotal,
    pixTotal: storeOffer.pixTotal,
    installments: {
      count: storeOffer.installmentsCount,
      value: round2(storeOffer.installmentsTotal / storeOffer.installmentsCount),
    },
    notes: null,
  };
  return { quote, storeOffer };
}
