/**
 * Quem fornece cada campo do modelo — base do fluxo "contrato em 3 cliques":
 *
 * - auto: a data de hoje ([Dia], [Mês], [Ano]);
 * - agency: dado fixo da agência, preenchido uma vez em "Dados da agência";
 * - client: dado pessoal que o cliente manda pelo WhatsApp;
 * - seller: o resto (valores, datas da viagem…), o vendedor digita ou a IA lê.
 *
 * Funções puras. A comparação ignora caixa e acento: "[Mes]" e "[MÊS]" são
 * o mesmo campo para a classificação.
 */

export type FieldGroup = 'auto' | 'agency' | 'client' | 'seller';

export interface FieldGroups {
  client: string[];
  seller: string[];
  agency: string[];
  auto: string[];
}

const AUTO_FIELDS = new Set(['dia', 'mes', 'ano']);
const AGENCY_EXACT = new Set(['cidade', 'uf']);
const AGENCY_PREFIXES = ['percentual', 'prazo'] as const;
const AGENCY_MARKER = 'da agencia';
const CLIENT_MARKERS = ['do cliente', 'do menor', 'do responsavel legal', 'passageiro'] as const;

/** Rótulos que o cliente entende melhor que o nome do campo. */
const LABEL_OVERRIDES = new Map<string, string>([
  ['nome', 'Nome completo'],
  ['endereco', 'Endereço completo com CEP'],
]);

const CLIENT_SUFFIX_RE = /\s+do\s+cliente$/i;

/** Sem colchetes, sem acento, minúsculo, espaços simples. */
export function normalizeFieldName(name: string): string {
  return stripBrackets(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function stripBrackets(name: string): string {
  const trimmed = (name ?? '').trim();
  const inner = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  return inner.trim();
}

export function classifyPlaceholder(name: string): FieldGroup {
  const key = normalizeFieldName(name);
  if (AUTO_FIELDS.has(key)) return 'auto';
  if (
    key.includes(AGENCY_MARKER) ||
    AGENCY_EXACT.has(key) ||
    AGENCY_PREFIXES.some((prefix) => key.startsWith(prefix))
  ) {
    return 'agency';
  }
  if (CLIENT_MARKERS.some((marker) => key.includes(marker))) return 'client';
  return 'seller';
}

/** Sigla (CPF, RG, CEP) fica como está; as demais palavras, minúsculas. */
function sentenceCase(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words
    .map((word, index) => {
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      return word === word.toUpperCase() ? word : word.toLowerCase();
    })
    .join(' ');
}

/**
 * Rótulo para a mensagem ao cliente: "[CPF do Cliente]" → "CPF",
 * "[Nome do Cliente]" → "Nome completo", "[Nome do Menor]" → "Nome do menor".
 */
export function friendlyLabel(name: string): string {
  const base = stripBrackets(name).replace(CLIENT_SUFFIX_RE, '').trim();
  const override = LABEL_OVERRIDES.get(normalizeFieldName(base));
  if (override) return override;
  return sentenceCase(base);
}

/** Todos os campos, na ordem do modelo, separados por grupo. */
export function groupPlaceholders(placeholders: readonly string[]): FieldGroups {
  const of = (group: FieldGroup) => placeholders.filter((p) => classifyPlaceholder(p) === group);
  return { client: of('client'), seller: of('seller'), agency: of('agency'), auto: of('auto') };
}
