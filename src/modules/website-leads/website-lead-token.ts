import { createHash, randomBytes } from 'crypto';

const TOKEN_BYTES = 32;
const TOKEN_PREFIX = 'wl_';
const PREVIEW_CHARS = 4;

/** Token novo do webhook do site (alta entropia: sha256 simples basta). */
export function generateLeadToken(): string {
  return TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashLeadToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

export function previewLeadToken(token: string): string {
  return `${TOKEN_PREFIX}…${token.slice(-PREVIEW_CHARS)}`;
}

export const WEBSITE_LEAD_PATH = '/api/v1/public/leads/website';

/** Caminho que vai no Elementor. A origem (domínio da API) o web completa. */
export function webhookPath(token: string, form?: 'guiamento'): string {
  const q = new URLSearchParams({ token });
  if (form) q.set('form', form);
  return `${WEBSITE_LEAD_PATH}?${q.toString()}`;
}
