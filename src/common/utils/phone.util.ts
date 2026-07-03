/** Normaliza telefone para só-dígitos (ex.: "+55 (11) 98201-5967" -> "5511982015967"). */
export function normalizePhone(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length < 10) {
    throw new Error('Telefone inválido: informe DDI/DDD e o número completo.');
  }
  return digits;
}
