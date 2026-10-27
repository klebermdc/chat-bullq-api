import { QUOTE_MAX_ITEMS } from './quote.constants';
import type { QuoteData } from './quote.types';

const toCents = (n: number) => Math.round(n * 100);

/**
 * Junta as leituras de vários prints (cada um lido sozinho) numa cotação só.
 * Itens na ordem dos prints, até o máximo; total = soma dos itens. Pix só
 * quando TODOS os prints têm (um Pix parcial seria preço errado ao cliente).
 * Parcelas ficam para o atendente: o editor calcula do total.
 */
export function mergeQuotes(parts: readonly QuoteData[]): QuoteData {
  if (parts.length === 1) return parts[0];
  const items = parts.flatMap((p) => p.items).slice(0, QUOTE_MAX_ITEMS);
  const allPix = parts.every((p) => p.pixTotal !== null);
  return {
    items,
    currency: parts[0].currency,
    total: items.reduce((acc, i) => acc + toCents(i.total), 0) / 100,
    pixTotal: allPix ? parts.reduce((acc, p) => acc + toCents(p.pixTotal ?? 0), 0) / 100 : null,
    installments: null,
    notes: null,
  };
}
