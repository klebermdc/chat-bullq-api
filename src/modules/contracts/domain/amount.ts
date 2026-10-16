export type Currency = 'BRL' | 'USD';
export interface ParsedAmount {
  currency: Currency;
  value: number;
}

/** Só pontos em grupos de 3 ("2.190", "1.234.567") = separador de milhar em BRL. */
const BRL_DOT_THOUSANDS = /^\d{1,3}(\.\d{3})+$/;

/**
 * Lê o valor como o Lovable gravava (texto livre).
 * USD ("$ ..."): vírgula = milhar, ponto = decimal.
 * BRL: com vírgula e ponto, o último separador é o decimal; só vírgula = decimal;
 * só pontos em grupos de 3 = milhar; ponto com 1–2 casas ("748.5") = decimal.
 */
export function parseAmount(raw: string): ParsedAmount | null {
  const text = (raw ?? '').trim();
  const currency: Currency = /^\$|US\$/i.test(text) ? 'USD' : 'BRL';
  const numeric = text.replace(/[^\d.,]/g, '');
  if (!/\d/.test(numeric)) return null;
  const normalized = currency === 'USD' ? numeric.replace(/,/g, '') : normalizeBrl(numeric);
  const value = Number(normalized);
  return Number.isFinite(value) ? { currency, value: Math.round(value * 100) / 100 } : null;
}

function normalizeBrl(numeric: string): string {
  const lastComma = numeric.lastIndexOf(',');
  const lastDot = numeric.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandsSep = decimalSep === ',' ? '.' : ',';
    return numeric.split(thousandsSep).join('').replace(decimalSep, '.');
  }
  if (lastComma >= 0) return numeric.replace(',', '.');
  if (BRL_DOT_THOUSANDS.test(numeric)) return numeric.replace(/\./g, '');
  return numeric;
}
