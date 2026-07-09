/** Normaliza telefone para só-dígitos (ex.: "+55 (11) 98201-5967" -> "5511982015967"). */
export function normalizePhone(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length < 10) {
    throw new Error('Telefone inválido: informe DDI/DDD e o número completo.');
  }
  return digits;
}

/**
 * Sufixo usado para casar um lead do formulário (texto livre) com o telefone
 * do WhatsApp (E.164). Usa os últimos 10 dígitos para absorver divergência de
 * DDI/9º dígito. Tradeoff aceito: números muito parecidos podem colidir.
 */
export function phoneMatchSuffix(normalized: string): string {
  return normalized.length > 10 ? normalized.slice(-10) : normalized;
}
