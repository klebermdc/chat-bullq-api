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

    // Presença de produto: por produto distinto pedido, verifica se está no
    // carrinho. NÃO compara quantidade aqui — pedidos legítimos costumam vir
    // "quebrados" por tipo (adulto/criança) no mesmo produto.
    const distinctProducts = new Map<string, string>();
    for (const item of order.items) {
      const normProduto = norm(item.produto);
      if (!distinctProducts.has(normProduto)) {
        distinctProducts.set(normProduto, item.produto);
      }
    }

    let allProductsPresent = true;
    for (const [normProduto, produto] of distinctProducts) {
      if (!cartProducts.includes(normProduto)) {
        allProductsPresent = false;
        out.push({
          kind: 'ITEM_MISMATCH',
          message: `Cliente pediu "${produto}" · não está no carrinho enviado`,
          detail: { pedido: produto, carrinho: cart.parks },
          detectedAt,
        });
      }
    }

    // Quantidade: agregada (soma de todos os itens pedidos vs headcount total
    // do carrinho), e só verificada quando todos os produtos batem — evita
    // falso positivo em splits por tipo (ex.: 4 adultos + 2 crianças = 6).
    if (allProductsPresent) {
      const totalOrdered = order.items.reduce((sum, item) => sum + item.quantidade, 0);
      if (totalOrdered !== cartQty) {
        out.push({
          kind: 'ITEM_MISMATCH',
          message: `Cliente pediu ${totalOrdered} pessoa(s) · carrinho tem ${cartQty}`,
          detail: { totalPedido: totalOrdered, totalCarrinho: cartQty },
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
