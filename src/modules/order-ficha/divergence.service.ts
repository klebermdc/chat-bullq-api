import { Injectable } from '@nestjs/common';
import { ExtractedCart } from '../proposals/proposals.types';
import { Divergence, ExtractedOrder } from './order-ficha.types';

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();

const dayOf = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/**
 * Comparação determinística entre o que o cliente pediu na conversa (ficha)
 * e o carrinho realmente extraído do link enviado ao HUB.
 *
 * Puro: sem chamada a LLM, sem acesso a banco. Recebe os dois lados já
 * estruturados e devolve a lista de divergências encontradas.
 */
@Injectable()
export class DivergenceService {
  compare(order: ExtractedOrder, cart: ExtractedCart, now: Date = new Date()): Divergence[] {
    const out: Divergence[] = [];
    const detectedAt = now.toISOString();
    const cartQty = (cart.adults ?? 0) + (cart.children ?? 0);
    const cartProducts = (cart.parks ?? []).map((p) => norm(p.nome));

    for (const item of order.items) {
      const normProduto = norm(item.produto);
      if (!cartProducts.includes(normProduto)) {
        out.push({
          kind: 'ITEM_MISMATCH',
          message: `Cliente pediu "${item.produto}" · não está no carrinho enviado`,
          detail: { pedido: item, carrinho: cart.parks },
          detectedAt,
        });
      } else if (item.quantidade !== cartQty) {
        out.push({
          kind: 'ITEM_MISMATCH',
          message: `Cliente pediu ${item.quantidade}x ${item.produto} · carrinho tem ${cartQty}`,
          detail: { pedidoQtd: item.quantidade, carrinhoQtd: cartQty, produto: item.produto },
          detectedAt,
        });
      }
    }

    const orderDay = dayOf(order.travelStart);
    const cartDay = dayOf(cart.startDate);
    if (orderDay && cartDay && orderDay !== cartDay) {
      out.push({
        kind: 'TRAVEL_DATE_MISMATCH',
        message: `Cliente pediu viagem começando ${orderDay} · carrinho está ${cartDay}`,
        detail: { pedido: orderDay, carrinho: cartDay },
        detectedAt,
      });
    }

    return out;
  }
}
