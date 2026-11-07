/** Validação do lead do site: telefone E.164 e filtro de spam óbvio. */

const MIN_DIGITS = 10;
const MAX_DIGITS = 15;
const BR_NATIONAL_LENGTHS = [10, 11];
/** 55 + DDD (sem zero) + fixo (8, começa com 2-5) ou celular (9 + 8). */
const BR_PHONE = /^55([1-9][1-9])(9\d{8}|[2-5]\d{7})$/;

/**
 * Telefone só-dígitos com DDI (E.164 sem o "+"), ou null se inválido.
 * Sem "+", 10–11 dígitos (ou com 0 na frente) são número brasileiro.
 */
export function normalizeLeadPhone(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const explicitDdi = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '').replace(/^0+/, '');
  if (!explicitDdi && BR_NATIONAL_LENGTHS.includes(digits.length)) digits = `55${digits}`;
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
  if (digits.startsWith('55')) return BR_PHONE.test(digits) ? digits : null;
  return explicitDdi ? digits : null;
}

const LINK = /(https?:\/\/|www\.|\.(ru|cn|xyz|top)\b)/i;
const STRANGE_SCRIPT = /[Ѐ-ӿ一-鿿؀-ۿ]/;

/** Motivo do descarte, ou null se o lead parece legítimo. */
export function detectSpam(lead: {
  name: string | null;
  email: string | null;
  phone: string;
}): string | null {
  const name = lead.name ?? '';
  if (LINK.test(name)) return 'link_no_nome';
  if (STRANGE_SCRIPT.test(name)) return 'alfabeto_estranho';
  const local = lead.phone.startsWith('55') ? lead.phone.slice(4) : lead.phone;
  if (/^(\d)\1+$/.test(local)) return 'telefone_repetido';
  return null;
}
