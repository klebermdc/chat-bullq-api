/**
 * Dados pessoais do cliente lembrados dos contratos (`contact_personal_data`).
 * O mapa campo↔coluna mora só aqui. Funções puras — e nunca logam valores.
 *
 * O casamento campo↔coluna ignora caixa e acento (`normalizeFieldName`, o
 * mesmo da classificação): "[cpf do cliente]" e "[Endereco do Cliente]" são
 * os mesmos campos de "[CPF do Cliente]" e "[Endereço do Cliente]".
 */
import { normalizeFieldName } from './field-groups.util';

export const PERSONAL_DATA_FIELDS = {
  '[CPF do Cliente]': 'cpf',
  '[RG do Cliente]': 'rg',
  '[Endereço do Cliente]': 'address',
  '[Estado Civil do Cliente]': 'maritalStatus',
  '[Nacionalidade do Cliente]': 'nationality',
  '[Data de Nascimento do Cliente]': 'birthDate',
} as const;

export type PersonalDataColumn = (typeof PERSONAL_DATA_FIELDS)[keyof typeof PERSONAL_DATA_FIELDS];

export type PersonalData = Partial<Record<PersonalDataColumn, string | null>>;

/** Teto por valor gravado: endereço completo cabe, texto colado não. */
export const MAX_PERSONAL_VALUE_LENGTH = 500;

const FIELD_ENTRIES = Object.entries(PERSONAL_DATA_FIELDS) as [string, PersonalDataColumn][];

/** Nome normalizado do campo → coluna. */
const COLUMN_BY_NAME = new Map<string, PersonalDataColumn>(
  FIELD_ENTRIES.map(([placeholder, column]) => [normalizeFieldName(placeholder), column]),
);

/** Coluna do campo (qualquer grafia), ou null se não é dado pessoal lembrado. */
export function personalDataColumn(placeholder: string): PersonalDataColumn | null {
  return COLUMN_BY_NAME.get(normalizeFieldName(placeholder)) ?? null;
}

/** Colunas que o Prisma deve ler (select). */
export const PERSONAL_DATA_SELECT = Object.fromEntries(
  FIELD_ENTRIES.map(([, column]) => [column, true]),
) as Record<PersonalDataColumn, true>;

/**
 * Linha gravada → `{ "[Campo]": "…" }`, só o que tem valor. Com `placeholders`
 * (campos do modelo), devolve na grafia do modelo; sem, na grafia canônica.
 */
export function personalDataToValues(
  row: PersonalData | null | undefined,
  placeholders: readonly string[] = FIELD_ENTRIES.map(([placeholder]) => placeholder),
): Record<string, string> {
  if (!row) return {};
  const entries = placeholders.flatMap((placeholder) => {
    const column = personalDataColumn(placeholder);
    const value = column ? (row[column] ?? '').trim() : '';
    return value ? [[placeholder, value] as const] : [];
  });
  return Object.fromEntries(entries);
}

/**
 * Valores do contrato → colunas a gravar. Só campos mapeados e não vazios:
 * valor vazio nunca apaga um dado já lembrado.
 */
export function valuesToPersonalData(values: Readonly<Record<string, string>>): PersonalData {
  const entries = Object.entries(values).flatMap(([placeholder, raw]) => {
    const column = personalDataColumn(placeholder);
    const value = column && typeof raw === 'string' ? raw.trim().slice(0, MAX_PERSONAL_VALUE_LENGTH) : '';
    return column && value ? [[column, value] as const] : [];
  });
  // Mesma coluna em duas grafias: a primeira com valor vale.
  const byColumn = new Map<PersonalDataColumn, string>();
  entries.forEach(([column, value]) => {
    if (!byColumn.has(column)) byColumn.set(column, value);
  });
  return Object.fromEntries(byColumn) as PersonalData;
}
