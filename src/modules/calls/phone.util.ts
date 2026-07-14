/**
 * Normaliza um telefone brasileiro para o formato E.164 sem "+": DDI 55 + DDD + número.
 * Aceita máscara, JID do WhatsApp e números com/sem DDI. Lança se ficar curto demais.
 */
export function normalizeBrazilNumber(input: string): string {
  const digits = (input || '').replace(/\D/g, '');
  if (digits.length < 10) {
    throw new Error(`Número inválido para discagem: "${input}"`);
  }
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  return digits;
}
