/**
 * Campos de modelo de documento: `[Qualquer Coisa]` no corpo do texto.
 *
 * Funções puras — sem Nest, sem Prisma — para serem testadas à exaustão e
 * reaproveitadas pelo serviço, pelo PDF e pelo script de importação.
 */

/** Teto por valor preenchido. Endereço longo cabe; colar um livro, não. */
export const MAX_VALUE_LENGTH = 2000;

/** Teto de chaves num preenchimento. Modelo real tem dezenas, não centenas. */
export const MAX_VALUE_KEYS = 200;

/**
 * Um campo: colchete, conteúdo sem colchete nem quebra de linha, colchete.
 * Sem quebra de linha de propósito: um `[` solto num parágrafo não pode
 * engolir o texto até o próximo `]` três linhas abaixo.
 */
const PLACEHOLDER_RE = /\[([^[\]\n]*)\]/g;

/**
 * Forma canônica do campo: COM colchetes e sem espaço nas bordas de dentro
 * (`[ Dia ]` → `[Dia]`). É assim que o campo aparece em `placeholders`,
 * `missing` e nas chaves do autofill — e como a tela manda `values`.
 */
export function canonicalKey(key: string): string {
  const k = key.trim();
  const inner = k.startsWith('[') && k.endsWith(']') ? k.slice(1, -1) : k;
  return `[${inner.trim()}]`;
}

export type TemplateValues = Readonly<Record<string, string>>;

export interface FillResult {
  text: string;
  /** Campos do modelo sem valor (vazio/só espaço). Ficam no texto como estão. */
  missing: string[];
}

/** Campos únicos do corpo (`[Nome]`, com colchetes), na ordem da primeira aparição. */
export function extractPlaceholders(body: string): string[] {
  const names = Array.from((body ?? '').matchAll(PLACEHOLDER_RE), (m) => m[1].trim());
  // Colchete vazio/só espaço (`[ ]`, caixinha de marcar) não é campo.
  return [...new Set(names.filter((name) => name.length > 0).map((name) => `[${name}]`))];
}

/**
 * Normaliza o que veio do cliente: chave na forma canônica (`[Campo]`; aceita
 * também sem colchetes), só strings, aparadas, cortadas em
 * `MAX_VALUE_LENGTH`, no máximo `MAX_VALUE_KEYS` chaves. Devolve objeto novo.
 */
export function normalizeValues(
  values: Record<string, unknown> | null | undefined,
): Record<string, string> {
  if (!values || typeof values !== 'object') return {};
  const entries = Object.entries(values)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .slice(0, MAX_VALUE_KEYS)
    .map(([key, value]) => [canonicalKey(key), value.trim().slice(0, MAX_VALUE_LENGTH)] as const);
  return Object.fromEntries(entries);
}

/**
 * Preenche o corpo numa passada só: um valor que contenha `[Outro Campo]` não
 * é substituído de novo. O replace usa função, então `$&`/`$1` no valor saem
 * literais.
 */
export function fillTemplate(
  body: string,
  values: Record<string, unknown> | null | undefined,
): FillResult {
  // Map, não objeto: `[constructor]` ou `[toString]` no corpo não podem
  // achar o que vem do protótipo.
  const normalized = new Map(Object.entries(normalizeValues(values)));
  const missing = extractPlaceholders(body).filter((name) => !normalized.get(name));
  const text = (body ?? '').replace(PLACEHOLDER_RE, (match, inner: string) => {
    const value = normalized.get(`[${inner.trim()}]`);
    return value ? value : match;
  });
  return { text, missing };
}
