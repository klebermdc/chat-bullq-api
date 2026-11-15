/**
 * "Dados da agência": valores fixos que a org cadastra uma vez para os
 * campos dos modelos (`contract_settings.field_defaults`). Funções puras.
 */
import { MAX_PLACEHOLDER_LENGTH, canonicalKey } from './placeholders.util';
import { classifyPlaceholder } from './field-groups.util';

export const MAX_DEFAULT_VALUE_LENGTH = 500;
export const MAX_DEFAULT_ENTRIES = 80;

/** Chave válida: `[` + 1–150 caracteres sem colchete nem quebra de linha + `]`. */
const DEFAULT_KEY_RE = new RegExp(`^\\[[^[\\]\\n]{1,${MAX_PLACEHOLDER_LENGTH}}\\]$`);

/** Campos da empresa que têm coluna própria em `contract_settings`. */
export const COMPANY_FIELDS = {
  '[Razão Social da Agência]': 'companyName',
  '[CNPJ da Agência]': 'companyDocument',
  '[Endereço da Agência]': 'companyAddress',
} as const;

export type CompanyColumns = Partial<Record<(typeof COMPANY_FIELDS)[keyof typeof COMPANY_FIELDS], string | null>>;

export function isDefaultKey(key: string): boolean {
  return DEFAULT_KEY_RE.test(key) && key.slice(1, -1).trim().length > 0;
}

/** Lê o JSON do banco com desconfiança: só pares chave válida → texto. */
export function readFieldDefaults(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    (entry): entry is [string, string] =>
      isDefaultKey(entry[0]) && typeof entry[1] === 'string' && entry[1].trim().length > 0,
  );
  return Object.fromEntries(entries);
}

/**
 * Junta o que veio da tela ao que já está gravado: valor aparado substitui,
 * valor vazio remove a chave, chave ausente fica como estava. Objeto novo.
 */
export function mergeFieldDefaults(
  current: Readonly<Record<string, string>>,
  incoming: Readonly<Record<string, string>>,
): Record<string, string> {
  const merged = new Map(Object.entries(current));
  Object.entries(incoming).forEach(([key, value]) => {
    const trimmed = value.trim();
    const canonical = canonicalKey(key);
    if (trimmed) merged.set(canonical, trimmed);
    else merged.delete(canonical);
  });
  return Object.fromEntries(merged);
}

/**
 * Campos de agência dos modelos ativos que a tela deve oferecer, em ordem
 * alfabética. Razão social/CNPJ/endereço saem só se a coluna própria já tem
 * valor (senão a agência preenche aqui mesmo).
 */
export function suggestAgencyFields(
  placeholders: readonly string[],
  company: CompanyColumns | null,
): string[] {
  const companyMap = new Map<string, string>(Object.entries(COMPANY_FIELDS));
  const hasColumn = (name: string): boolean => {
    const column = companyMap.get(name) as keyof CompanyColumns | undefined;
    return Boolean(column && company?.[column]?.trim());
  };
  const distinct = [...new Set(placeholders)];
  return distinct
    .filter((name) => classifyPlaceholder(name) === 'agency' && !hasColumn(name))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
