import { BadRequestException } from '@nestjs/common';

const BR_DDI = '55';
/** DDD (2) + número (8 fixo / 9 celular) — o que o operador digita sem o DDI. */
const BR_NATIONAL_LENGTHS = [10, 11];
const MIN_PHONE_DIGITS = 10;

/**
 * Normaliza telefone para só-dígitos com DDI (ex.: "+55 (11) 98201-5967" e
 * "(11) 98201-5967" -> "5511982015967").
 *
 * Sem `+` explícito, 10–11 dígitos são tratados como número brasileiro
 * digitado sem o 55 — antes eles iam como estavam e o WhatsApp entregava
 * para outro país (11 98201-5967 virava +1 198...).
 */
export function normalizePhone(raw: string): string {
  const trimmed = (raw || '').trim();
  const hasExplicitDdi = trimmed.startsWith('+');
  // "0055..." (prefixo internacional) e "011..." (0 de operadora/DDD).
  const digits = trimmed.replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length < MIN_PHONE_DIGITS) {
    throw new BadRequestException('Telefone inválido: informe DDD e o número completo.');
  }
  if (!hasExplicitDdi && BR_NATIONAL_LENGTHS.includes(digits.length)) {
    return BR_DDI + digits;
  }
  return digits;
}

/**
 * O telefone e a outra forma dele quanto ao 9º dígito, se for celular
 * brasileiro. O WhatsApp identifica muitos celulares BR SEM o 9
 * (5511 8201-5967), enquanto o operador digita COM ele — sem casar as duas
 * formas, a resposta do cliente caía num contato/conversa diferente.
 */
export function phoneVariants(digits: string): string[] {
  const br = /^55([1-9][1-9])(9?)([6-9]\d{7})$/.exec(digits);
  if (!br) return [digits];
  const [, ddd, nine, local] = br;
  const other = nine ? `${BR_DDI}${ddd}${local}` : `${BR_DDI}${ddd}9${local}`;
  return [digits, other];
}

/**
 * Variantes de um external id de contato (`<dígitos>` na Meta ou
 * `<dígitos>@s.whatsapp.net` no Zappfy). `@lid`, grupos e ids que não são
 * telefone voltam como estão.
 */
export function externalIdVariants(externalId: string): string[] {
  const at = externalId.indexOf('@');
  const user = at === -1 ? externalId : externalId.slice(0, at);
  const suffix = at === -1 ? '' : externalId.slice(at);
  if (suffix && suffix !== '@s.whatsapp.net') return [externalId];
  if (!/^\d+$/.test(user)) return [externalId];
  return phoneVariants(user).map((v) => v + suffix);
}
