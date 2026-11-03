/**
 * Canal de urgência: passageiro JÁ em viagem, com problema urgente, quando
 * ninguém da equipe está online. A Aline manda um link que abre o WhatsApp
 * de emergência com a mensagem do cliente já escrita.
 *
 * O número só sai pela ferramenta `sendEmergencyContact`, que confere as
 * provas antes. O replyToConversation bloqueia o número em texto livre.
 */
export const EMERGENCY_PHONE = '(11) 5194-1724';
const EMERGENCY_PHONE_E164 = '551151941724';
/** Parte do número que identifica a linha, com ou sem DDI/DDD. */
const EMERGENCY_PHONE_LINE = '51941724';

export const EMERGENCY_CONTACT_TOOL = 'sendEmergencyContact';

/** Trecho citado menor que isso não prova nada ("orlando", "sim"). */
const MIN_QUOTE_LENGTH = 12;

export function buildEmergencyLink(
  contactName: string | null,
  problem: string,
  ticketNumber: string | null = null,
): string {
  const name = contactName?.trim();
  const intro = name ? `Olá! Sou ${name}, cliente` : 'Olá! Sou cliente';
  const ticket = ticketNumber ? ` (chamado ${ticketNumber})` : '';
  const text = `${intro} da Orlando Fast Pass. Estou em viagem e preciso de ajuda urgente${ticket}: ${problem.trim()}`;
  return `https://wa.me/${EMERGENCY_PHONE_E164}?text=${encodeURIComponent(text)}`;
}

/** `true` se o texto traz o número de emergência, em qualquer formatação. */
export function mentionsEmergencyPhone(text: string): boolean {
  if (!text) return false;
  return text.replace(/[\s().+\-]/g, '').includes(EMERGENCY_PHONE_LINE);
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * `true` se `quote` aparece, literalmente, em alguma mensagem do cliente.
 * Ignora acento, maiúscula e pontuação. É a prova de que a Aline não
 * inventou que o cliente está no destino.
 */
export function isQuoteFromCustomer(quote: string, customerTexts: string[]): boolean {
  const wanted = normalize(quote ?? '');
  if (wanted.length < MIN_QUOTE_LENGTH) return false;
  return customerTexts.some((text) => normalize(text).includes(wanted));
}

interface StoredMessage {
  content: unknown;
  metadata: unknown;
}

/** O que o cliente disse numa mensagem: texto, legenda ou áudio transcrito. */
export function customerTextOf({ content, metadata }: StoredMessage): string {
  const c = (content ?? {}) as Record<string, any>;
  if (typeof c.text === 'string') return c.text;
  if (typeof c.caption === 'string') return c.caption;
  const transcript = ((metadata ?? {}) as Record<string, any>).transcription?.text;
  return typeof transcript === 'string' ? transcript : '';
}
