export type Currency = 'BRL' | 'USD';
export interface ParsedAmount {
  currency: Currency;
  value: number;
}

/**
 * Lê o valor como o Lovable gravava (texto livre). BRL usa vírgula decimal;
 * USD ("$ ...") usa ponto decimal e vírgula de milhar.
 */
export function parseAmount(raw: string): ParsedAmount | null {
  const text = (raw ?? '').trim();
  const currency: Currency = /^\$|US\$/i.test(text) ? 'USD' : 'BRL';
  const numeric = text.replace(/[^\d.,]/g, '');
  if (!/\d/.test(numeric)) return null;
  let normalized: string;
  if (currency === 'USD') {
    normalized = numeric.replace(/,/g, '');
  } else if (numeric.includes(',')) {
    normalized = numeric.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = numeric;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? { currency, value: Math.round(value * 100) / 100 } : null;
}
