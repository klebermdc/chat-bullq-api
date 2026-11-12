import { BadRequestException } from '@nestjs/common';
import { QUOTE_STORE_URL_MAX } from './quote.constants';

/**
 * Link do carrinho da loja (Just Travel) de onde a cotação é lida. O servidor
 * abre esse endereço num navegador, então só passa o carrinho da NOSSA loja —
 * https, host exato, sem porta nem usuário, caminho `/<idioma>/checkout/<id>`.
 * É a trava de SSRF: qualquer outra coisa é recusada antes de renderizar.
 */
export const STORE_LINK_MAX = QUOTE_STORE_URL_MAX;
export const STORE_LINK_RE =
  /^https:\/\/reservas\.orlandofastpass\.com\.br\/[a-z]{2}\/checkout\/[A-Za-z0-9_-]+\/?(?:\?[^\s#]*)?$/;
export const STORE_LINK_ERROR =
  'Use o link do carrinho da loja (https://reservas.orlandofastpass.com.br/pt/checkout/...).';
export const STORE_LINK_TOO_LONG = `O link do carrinho da loja pode ter até ${STORE_LINK_MAX} caracteres.`;

export function isStoreCartLink(value: unknown): value is string {
  return typeof value === 'string' && value.length <= STORE_LINK_MAX && STORE_LINK_RE.test(value);
}

/**
 * `storeLink` do body: ausente → null; fora da loja → 400. O DTO já recusa,
 * mas quem renderiza confere de novo (trava de SSRF não depende só do pipe).
 */
export function storeLinkOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!isStoreCartLink(value)) throw new BadRequestException(STORE_LINK_ERROR);
  return value;
}
