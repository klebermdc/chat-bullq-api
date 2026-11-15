/**
 * Dados pessoais do cliente lembrados dos contratos (`contact_personal_data`).
 * O mapa campo↔coluna mora só aqui. Funções puras — e nunca logam valores.
 */

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

/** Colunas que o Prisma deve ler (select). */
export const PERSONAL_DATA_SELECT = Object.fromEntries(
  FIELD_ENTRIES.map(([, column]) => [column, true]),
) as Record<PersonalDataColumn, true>;

/** Linha gravada → `{ "[CPF do Cliente]": "…" }`, só o que tem valor. */
export function personalDataToValues(row: PersonalData | null | undefined): Record<string, string> {
  if (!row) return {};
  const entries = FIELD_ENTRIES.flatMap(([placeholder, column]) => {
    const value = (row[column] ?? '').trim();
    return value ? [[placeholder, value] as const] : [];
  });
  return Object.fromEntries(entries);
}

/**
 * Valores do contrato → colunas a gravar. Só campos mapeados e não vazios:
 * valor vazio nunca apaga um dado já lembrado.
 */
export function valuesToPersonalData(values: Readonly<Record<string, string>>): PersonalData {
  const known = new Map(Object.entries(values));
  const entries = FIELD_ENTRIES.flatMap(([placeholder, column]) => {
    const raw = known.get(placeholder);
    const value = typeof raw === 'string' ? raw.trim().slice(0, MAX_PERSONAL_VALUE_LENGTH) : '';
    return value ? [[column, value] as const] : [];
  });
  return Object.fromEntries(entries) as PersonalData;
}
