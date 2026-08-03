import * as crypto from 'crypto';

/** Janela de tolerância do timestamp, em segundos. Barra replay de webhook antigo. */
const TOLERANCE_SECONDS = 300;

function header(headers: Record<string, unknown>, name: string): string | null {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

/**
 * Verifica a assinatura Svix que o Resend envia.
 *
 * A base assinada é `<svix-id>.<svix-timestamp>.<corpo cru>`, com HMAC-SHA256
 * sobre a chave decodificada de base64 (o prefixo `whsec_` não faz parte dela).
 * O header pode trazer várias assinaturas separadas por espaço — basta uma casar.
 *
 * IMPORTANTE: o corpo tem que ser o RAW BODY. O `main.ts` já sobe o Nest com
 * `{ rawBody: true }`, então use `req.rawBody`, nunca `JSON.stringify(req.body)`.
 */
export function verifySvixSignature(
  rawBody: string,
  headers: Record<string, unknown>,
  secret: string,
): boolean {
  const id = header(headers, 'svix-id');
  const timestamp = header(headers, 'svix-timestamp');
  const signatureHeader = header(headers, 'svix-signature');
  if (!id || !timestamp || !signatureHeader || !secret) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > TOLERANCE_SECONDS) return false;

  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  } catch {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');
  const expectedBuf = Buffer.from(expected);

  return signatureHeader.split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) return false;
    const candidate = Buffer.from(value);
    return candidate.length === expectedBuf.length && crypto.timingSafeEqual(candidate, expectedBuf);
  });
}
