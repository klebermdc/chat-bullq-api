import { randomBytes } from 'crypto';

/** Token opaco de 32 bytes (base64url, sem padding) — é o único fator de
 *  acesso à página pública, então precisa ser imprevisível. */
export function generateAcceptanceToken(): string {
  return randomBytes(32).toString('base64url');
}
