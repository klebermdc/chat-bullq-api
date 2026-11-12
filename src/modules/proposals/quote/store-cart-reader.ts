import { BadRequestException, type Logger } from '@nestjs/common';
import type { RenderService } from '../render.service';
import { PROPOSAL_STORE_RENDER_TIMEOUT_MS } from '../proposals.constants';
import { parseStoreCart, STORE_CART_READY_RE, StoreCartParseError, type StoreCart } from './store-cart-parser';

export const STORE_LINK_UNREADABLE =
  'Não consegui ler o link da loja. Confere se o carrinho abre no navegador e tenta de novo.';

/**
 * Abre o carrinho da loja num navegador, espera os preços chegarem e lê os
 * itens e totais sem modelo. Toda falha vira 400 com mensagem para o
 * atendente; o detalhe técnico fica só no log.
 */
export async function readStoreCart(render: RenderService, storeLink: string, logger: Logger): Promise<StoreCart> {
  const text = await render
    .renderWhenText(storeLink, STORE_CART_READY_RE, PROPOSAL_STORE_RENDER_TIMEOUT_MS)
    .catch((err: Error) => {
      logger.warn(`store_cart_render_failed url=${storeLink}: ${err?.message}`);
      throw new BadRequestException(STORE_LINK_UNREADABLE);
    });
  try {
    return parseStoreCart(text);
  } catch (err) {
    if (!(err instanceof StoreCartParseError)) throw err;
    logger.warn(`store_cart_parse_failed url=${storeLink}: ${err.message}`);
    throw new BadRequestException(err.message);
  }
}
