import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * E5.2a — Correlação exata pedido ↔ card.
 *
 * O atendente marca Ganho e informa o nº do pedido (E5.1), que fica em
 * `Card.metadata.orderNumber`. O HUB sincroniza os pedidos reais em
 * `OfpSalesOrder` (campo `pedido`). Aqui casamos os dois pelo número exato:
 * quando bate, marcamos o card como correlacionado (grava `ofpOrderExternalId`)
 * e enriquecemos o valor do card com o valor real da venda.
 *
 * Roda no fim do sync do HUB. Idempotente (pula cards já correlacionados) e
 * best-effort (nunca derruba o sync). A heurística pros pedidos órfãos
 * (sem card) é a fatia E5.2b.
 */
@Injectable()
export class OrderCorrelationService {
  private readonly logger = new Logger(OrderCorrelationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async correlateWonCards(): Promise<{ matched: number; checked: number }> {
    // Só cards Ganhos podem ter pedido fechado — conjunto pequeno e limitado.
    const wonCards = await this.prisma.card.findMany({ where: { status: 'WON' } });

    let matched = 0;
    let checked = 0;
    for (const card of wonCards) {
      const meta = (card.metadata as Record<string, unknown>) ?? {};
      const orderNumber =
        typeof meta.orderNumber === 'string' ? meta.orderNumber.trim() : '';
      if (!orderNumber) continue; // Ganho sem nº do pedido → nada a casar
      if (meta.ofpOrderExternalId) continue; // já correlacionado → idempotente
      checked++;

      const order = await this.prisma.ofpSalesOrder.findFirst({
        where: { pedido: orderNumber },
      });
      if (!order) continue; // pedido ainda não chegou do HUB (ou nº errado)

      await this.prisma.card.update({
        where: { id: card.id },
        data: {
          metadata: {
            ...meta,
            ofpOrderExternalId: order.externalId,
            correlatedAt: new Date().toISOString(),
          },
          ...(order.venda != null ? { value: order.venda } : {}),
        },
      });
      matched++;
    }

    if (checked > 0) {
      this.logger.log(
        `correlação HUB: ${matched}/${checked} cards Ganhos casados com pedido`,
      );
    }
    return { matched, checked };
  }
}
