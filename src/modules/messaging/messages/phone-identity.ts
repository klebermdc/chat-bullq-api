/**
 * Identidade de telefone entre canais.
 *
 * O contato é resolvido por `(channelId, externalId)`, sem casar por telefone —
 * a mesma pessoa em dois números vira dois `Contact`. Para reunir o histórico
 * dela é preciso comparar telefones, e aí não basta igualdade: o mesmo número
 * está gravado de formas diferentes conforme a época e o canal (com ou sem DDI,
 * com ou sem o 9º dígito que os celulares ganharam).
 */

const COUNTRY_CODE = '55';

/** DDD (2) + local (8). Abaixo disso o número não identifica uma pessoa. */
const MIN_IDENTIFIABLE_DIGITS = 10;

/** DDD (2) + local (9). */
const MAX_NATIONAL_DIGITS = 11;

const AREA_CODE_LENGTH = 2;

/** Faixa inicial dos celulares brasileiros — fixo nunca ganhou o 9º dígito. */
const MOBILE_PREFIXES = ['6', '7', '8', '9'];

function onlyDigits(raw: string | null | undefined): string {
  return (raw || '').replace(/\D/g, '');
}

/** Tira o DDI quando o que sobra ainda é um número nacional plausível. */
function toNational(digits: string): string {
  if (!digits.startsWith(COUNTRY_CODE)) return digits;
  const rest = digits.slice(COUNTRY_CODE.length);
  const isPlausible =
    rest.length >= MIN_IDENTIFIABLE_DIGITS && rest.length <= MAX_NATIONAL_DIGITS;
  return isPlausible ? rest : digits;
}

/**
 * A mesma linha escrita com e sem o 9º dígito. Só vale para celular: inventar
 * um 9 num fixo produziria um número de outra pessoa.
 */
function ninthDigitTwin(national: string): string | null {
  const area = national.slice(0, AREA_CODE_LENGTH);
  const local = national.slice(AREA_CODE_LENGTH);

  if (local.length === 9 && local.startsWith('9')) {
    return area + local.slice(1);
  }
  if (local.length === 8 && MOBILE_PREFIXES.includes(local[0])) {
    return `${area}9${local}`;
  }
  return null;
}

/**
 * Todas as formas em que este telefone pode estar gravado no banco. Serve de
 * cláusula `IN` para achar os contatos-irmãos da mesma pessoa.
 *
 * Devolve vazio quando o telefone é curto ou ausente — um `IN` com prefixo curto
 * casaria com meio banco e juntaria conversas de gente diferente.
 */
export function phoneVariants(raw: string | null | undefined): string[] {
  const digits = onlyDigits(raw);
  if (digits.length < MIN_IDENTIFIABLE_DIGITS) return [];

  const national = toNational(digits);
  const variants = new Set<string>([digits, national]);

  // Número fora do padrão brasileiro (internacional, por exemplo): fica só na
  // forma como veio. Adivinhar DDD/9º dígito nele não tem base nenhuma.
  if (national.length >= MIN_IDENTIFIABLE_DIGITS && national.length <= MAX_NATIONAL_DIGITS) {
    const twin = ninthDigitTwin(national);
    for (const form of twin ? [national, twin] : [national]) {
      variants.add(form);
      variants.add(COUNTRY_CODE + form);
    }
  }

  return [...variants];
}
