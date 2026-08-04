/**
 * Forma canônica do endereço. É a chave do dedupe: a mesma pessoa vinda do CRM,
 * de um pedido do HUB e de um CSV tem que colidir no @@unique.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

// Deliberadamente frouxo: recusa lixo óbvio sem tentar implementar a RFC 5322.
// Endereço que existe mas não recebe é problema de bounce, não de regex.
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

export function isValidEmail(raw: string | null | undefined): boolean {
  const normalized = normalizeEmail(raw);
  return normalized !== null && EMAIL_RE.test(normalized);
}
