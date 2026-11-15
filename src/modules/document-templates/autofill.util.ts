/**
 * Pré-preenchimento dos campos canônicos que o importador garante nos modelos.
 * Função pura: quem chama busca os dados (escopados por org) e passa aqui.
 *
 * Só preenche o que existe de verdade. Contact não tem CPF nem endereço, a
 * org não tem cidade nem representante legal cadastrados — esses campos ficam
 * para o atendente digitar, nunca com um valor deduzido.
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

function candidates(input: AutofillInput): Map<string, string | null | undefined> {
  const { settings, contact } = input;
  const date = saoPauloDateParts(input.now);
  // Map, não objeto: um campo `[constructor]` não pode achar o protótipo.
  return new Map<string, string | null | undefined>([
    ['[Razão Social da Agência]', settings?.companyName],
    ['[CNPJ da Agência]', settings?.companyDocument],
    ['[Endereço da Agência]', settings?.companyAddress],
    ['[Nome do Cliente]', contact?.name],
    ['[Telefone do Cliente]', contact?.phone],
    ['[E-mail do Cliente]', contact?.email],
    ['[Dia]', date.day],
    ['[Mês]', date.month],
    ['[Ano]', date.year],
  ]);
}

/** Valores para os campos do modelo que puderam ser preenchidos (chave `[Campo]`). */
export function buildAutofill(input: AutofillInput): Record<string, string> {
  const known = candidates(input);
  const entries = input.placeholders
    .map((name) => [name, (known.get(name) ?? '').trim()] as const)
    .filter(([, value]) => value.length > 0);
  return Object.fromEntries(entries);
}
