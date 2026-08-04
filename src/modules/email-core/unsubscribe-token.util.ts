import * as crypto from 'crypto';

function hmac(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Token `<subscriberId em base64url>.<hmac base64url>`.
 *
 * Sem tabela e sem expiração de propósito: link de descadastro em email antigo
 * precisa funcionar para sempre. Gmail e Outlook penalizam domínio cujo
 * descadastro falha.
 */
export function signUnsubscribeToken(subscriberId: string, secret: string): string {
  const payload = Buffer.from(subscriberId).toString('base64url');
  return `${payload}.${hmac(payload, secret)}`;
}

/** Devolve o subscriberId, ou null se o token for inválido por qualquer motivo. */
export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;

  const expected = hmac(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const id = Buffer.from(payload, 'base64url').toString('utf8');
    return id.length ? id : null;
  } catch {
    return null;
  }
}
