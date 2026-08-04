/**
 * Normaliza o que vem do HUB, que é digitado à mão e reflete isso.
 *
 * Levantado na produção em 2026-08-04 sobre 8.812 pedidos: `Ingresso` e
 * `Ingressos` convivem, `Seguro` e `Seguros` também, e `Ingresso e Hotel` é
 * uma compra de duas categorias — não uma terceira categoria.
 */

const PLURAIS: Record<string, string> = {
  ingressos: 'ingresso',
  seguros: 'seguro',
  hoteis: 'hotel',
  carros: 'carro',
};

/** Data anterior a isto é lixo: `1969-12-31` é o marco zero convertido. */
const ANO_MINIMO = 1990;

function singular(termo: string): string {
  return PLURAIS[termo] ?? termo;
}

export function normalizeCategories(produto: string | null | undefined): string[] {
  if (!produto?.trim()) return [];
  const partes = produto
    .toLowerCase()
    .split(/\s+e\s+|\s*\/\s*|\s*\+\s*/)
    .map((p) => singular(p.trim()))
    .filter(Boolean);
  return [...new Set(partes)];
}

export function normalizeSupplier(fornecedor: string | null | undefined): string | null {
  const limpo = fornecedor?.trim().toLowerCase();
  if (!limpo || limpo === '-') return null;
  return limpo;
}

export function parsePurchaseDate(data: Date | null | undefined): Date | null {
  if (!data || Number.isNaN(data.getTime())) return null;
  if (data.getFullYear() < ANO_MINIMO) return null;
  return data;
}
