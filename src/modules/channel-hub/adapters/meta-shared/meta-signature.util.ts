import * as crypto from 'crypto';
import { VerificationResponse } from '../../ports/types';

/**
 * Valida o `X-Hub-Signature-256` que a Meta envia em todo webhook.
 *
 * Compartilhado entre Instagram e Messenger: as duas plataformas usam
 * exatamente o mesmo esquema (HMAC-SHA256 do corpo cru com o App Secret).
 *
 * Sem `appSecret` configurado no canal, aceita sem validar — preserva o
 * comportamento historico do adapter do Instagram, onde o segredo e opcional.
 */
export function verifyMetaSignature(
  headers: Record<string, string>,
  rawBody: Buffer,
  appSecret?: string,
): boolean {
  if (!appSecret) return true;

  const signature = headers['x-hub-signature-256'];
  if (!signature) return false;

  const expected =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    // timingSafeEqual estoura quando os buffers tem tamanhos diferentes.
    return false;
  }
}

/**
 * Handshake de verificacao do webhook (GET). A Meta manda `hub.mode`,
 * `hub.verify_token` e `hub.challenge`; devolvemos o challenge como texto puro
 * quando o token confere.
 */
export function handleMetaVerification(
  query: Record<string, string>,
  verifyToken?: string,
): VerificationResponse {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];

  if (mode === 'subscribe' && token === verifyToken) {
    return { statusCode: 200, body: challenge };
  }

  return { statusCode: 403, body: { error: 'Verification failed' } };
}
