import * as crypto from 'crypto';

/**
 * Credencial do agente de voz: HMAC-SHA256 de `${timestamp}.${corpo}` com o
 * segredo compartilhado VOICE_SERVICE_SECRET. Sem segredo, nada passa.
 */
export const VOICE_MAX_SKEW_SEC = 300;
export const VOICE_TIMESTAMP_HEADER = 'x-voice-timestamp';
export const VOICE_SIGNATURE_HEADER = 'x-voice-signature';

export function signVoiceRequest(secret: string, timestamp: string, body: Buffer): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
}

export function verifyVoiceRequest(input: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  body: Buffer;
  now: Date;
}): boolean {
  const { secret, timestamp, signature, body, now } = input;
  if (!secret || !timestamp || !signature || !/^\d{9,12}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) {
    return false;
  }
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > VOICE_MAX_SKEW_SEC) return false;
  const expected = Buffer.from(signVoiceRequest(secret, timestamp, body), 'hex');
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
