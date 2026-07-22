import { createHash } from 'crypto';

/**
 * SHA-256 do telefone no formato que a Meta espera: só dígitos, com código do
 * país, sem "+", sem separadores. É o mesmo tratamento usado no envio da
 * Conversions API — extraído para cá porque agora dois caminhos precisam dele
 * (envio direto e payload do webhook de lead qualificado).
 *
 * Retorna null quando não há telefone utilizável, para o chamador simplesmente
 * omitir o campo em vez de mandar hash de string vazia.
 */
export function hashPhoneSha256(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  return createHash('sha256').update(digits).digest('hex');
}
