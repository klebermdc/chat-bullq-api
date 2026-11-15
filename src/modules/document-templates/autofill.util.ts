/**
 * Pré-preenchimento dos campos canônicos que o importador garante nos modelos.
 * Função pura: quem chama busca os dados (escopados por org) e passa aqui.
 *
 * Só preenche o que existe de verdade: dados fixos que a agência cadastrou,
 * colunas da empresa, contato, dados pessoais já lembrados e a data de hoje.
 * Nada é deduzido.
 */

const TIME_ZONE = 'America/Sao_Paulo';

const MONTHS_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
] as const;

export interface AgencySettings {
  companyName?: string | null;
  companyDocument?: string | null;
  companyAddress?: string | null;
}

export interface ClientContact {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface AutofillInput {
  placeholders: readonly string[];
  settings: AgencySettings | null;
  contact: ClientContact | null;
  now: Date;
  /** Dados fixos da agência (`contract_settings.field_defaults`). */
  defaults?: Readonly<Record<string, string>>;
  /** Dados pessoais lembrados do contato (`contact_personal_data`). */
  saved?: Readonly<Record<string, string>>;
}

export interface DateParts {
  day: string;
  month: string;
  year: string;
}

/** Dia/mês/ano de `now` no fuso de Brasília; mês por extenso, minúsculo. */
export function saoPauloDateParts(now: Date): DateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: get('day'),
    month: MONTHS_PT[Number(get('month')) - 1] ?? '',
    year: get('year'),
  };
}

export type AutofillSource = 'default' | 'agency' | 'contact' | 'saved' | 'date';

export interface AutofillResult {
  values: Record<string, string>;
  /** De onde veio cada valor preenchido. */
  sources: Record<string, AutofillSource>;
}

type Layer = readonly [AutofillSource, ReadonlyMap<string, string | null | undefined>];

/**
 * Camadas da menor para a maior precedência: dados fixos da agência
 * (fieldDefaults) → colunas da empresa → contato/dados lembrados → data.
 * Map, não objeto: um campo `[constructor]` não pode achar o protótipo.
 */
function layers(input: AutofillInput): Layer[] {
  const { settings, contact } = input;
  const date = saoPauloDateParts(input.now);
  return [
    ['default', new Map(Object.entries(input.defaults ?? {}))],
    ['agency', new Map([
      ['[Razão Social da Agência]', settings?.companyName],
      ['[CNPJ da Agência]', settings?.companyDocument],
      ['[Endereço da Agência]', settings?.companyAddress],
    ])],
    ['contact', new Map([
      ['[Nome do Cliente]', contact?.name],
      ['[Telefone do Cliente]', contact?.phone],
      ['[E-mail do Cliente]', contact?.email],
    ])],
    ['saved', new Map(Object.entries(input.saved ?? {}))],
    ['date', new Map([
      ['[Dia]', date.day],
      ['[Mês]', date.month],
      ['[Ano]', date.year],
    ])],
  ];
}

function resolveOne(name: string, all: readonly Layer[]): [string, string, AutofillSource] | null {
  const hit = [...all]
    .reverse()
    .map(([source, map]) => [source, (map.get(name) ?? '').trim()] as const)
    .find(([, value]) => value.length > 0);
  return hit ? [name, hit[1], hit[0]] : null;
}

/** Valores e origens para os campos do modelo (só os que existem no modelo). */
export function resolveAutofill(input: AutofillInput): AutofillResult {
  const all = layers(input);
  const resolved = input.placeholders
    .map((name) => resolveOne(name, all))
    .filter((hit): hit is [string, string, AutofillSource] => hit !== null);
  return {
    values: Object.fromEntries(resolved.map(([name, value]) => [name, value])),
    sources: Object.fromEntries(resolved.map(([name, , source]) => [name, source])),
  };
}

/** Valores para os campos do modelo que puderam ser preenchidos (chave `[Campo]`). */
export function buildAutofill(input: AutofillInput): Record<string, string> {
  return resolveAutofill(input).values;
}
