import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PipelinesService } from '../pipelines/pipelines.service';
import { scoreOrderAgainstContact } from './reconciliation.match';

export interface OrphanSuggestion {
  cardId: string;
  conversationId: string | null;
  contactName: string | null;
  score: number;
  reasons: string[];
}

export interface OrphanEntry {
  order: {
    externalId: string;
    pedido: string | null;
    cliente: string | null;
    venda: number | null;
    data: Date | null;
  };
  suggestions: OrphanSuggestion[];
}

/**
 * E5.2b — Fila de reconciliação.
 *
 * Pedidos do HUB (`OfpSalesOrder`) que NÃO casaram por nº exato (E5.2a) ficam
 * "órfãos". Aqui listamos os órfãos recentes e, pra cada um, sugerimos os cards
 * candidatos via heurística (telefone/email/nome/valor). O operador confirma o
 * vínculo (`link`), que marca o card como Ganho e grava a correlação.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipelines: PipelinesService,
  ) {}

  /** externalIds de pedidos que já têm um card apontando pra eles. */
  private async correlatedExternalIds(): Promise<Set<string>> {
    const cards = await this.prisma.card.findMany({
      where: { status: 'WON' },
      select: { metadata: true },
    });
    const ids = new Set<string>();
    for (const c of cards) {
      const ext = (c.metadata as Record<string, unknown> | null)?.ofpOrderExternalId;
      if (typeof ext === 'string') ids.add(ext);
    }
    return ids;
  }

  async listOrphans(
    opts: { sinceDays?: number; limit?: number; minScore?: number } = {},
  ): Promise<OrphanEntry[]> {
    const sinceDays = opts.sinceDays ?? 120;
    const limit = opts.limit ?? 50;
    const minScore = opts.minScore ?? 20;
    const since = new Date(Date.now() - sinceDays * 86_400_000);

    const correlated = await this.correlatedExternalIds();

    const orders = await this.prisma.ofpSalesOrder.findMany({
      where: { data: { gte: since } },
      orderBy: { data: 'desc' },
      take: limit + correlated.size,
    });
    const orphans = orders
      .filter((o) => !correlated.has(o.externalId))
      .slice(0, limit);

    // Candidatos: cards do funil com contato (conjunto de leads, pequeno).
    const cards = await this.prisma.card.findMany({
      where: { contactId: { not: null } },
      include: {
        contact: { select: { id: true, name: true, phone: true, email: true } },
      },
    });

    return orphans.map((order) => {
      const suggestions = cards
        .map((card): OrphanSuggestion => {
          const m = scoreOrderAgainstContact(
            {
              telefoneCliente: order.telefoneCliente,
              emailCliente: order.emailCliente,
              cliente: order.cliente,
              venda: order.venda != null ? Number(order.venda) : null,
            },
            card.contact ?? {},
            card.value != null ? Number(card.value) : null,
          );
          return {
            cardId: card.id,
            conversationId: card.conversationId,
            contactName: card.contact?.name ?? null,
            score: m.score,
            reasons: m.reasons,
          };
        })
        .filter((s) => s.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      return {
        order: {
          externalId: order.externalId,
          pedido: order.pedido ?? null,
          cliente: order.cliente ?? null,
          venda: order.venda != null ? Number(order.venda) : null,
          data: order.data ?? null,
        },
        suggestions,
      };
    });
  }

  /**
   * Vínculo manual pedido↔card: grava a correlação (nº do pedido +
   * ofpOrderExternalId), enriquece o valor e move o card pra etapa Ganho (WON).
   */
  async link(
    orderExternalId: string,
    cardId: string,
    organizationId: string,
  ): Promise<{ linked: true; cardId: string; orderExternalId: string }> {
    const order = await this.prisma.ofpSalesOrder.findUnique({
      where: { externalId: orderExternalId },
    });
    if (!order) throw new BadRequestException('Pedido não encontrado.');

    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card || card.organizationId !== organizationId) {
      throw new BadRequestException('Card não encontrado.');
    }

    const wonStage = await this.prisma.pipelineStage.findFirst({
      where: { pipelineId: card.pipelineId, type: 'WON' },
      orderBy: { order: 'asc' },
    });

    const meta = (card.metadata as Record<string, any>) ?? {};
    await this.prisma.card.update({
      where: { id: card.id },
      data: {
        metadata: {
          ...meta,
          orderNumber: order.pedido ?? meta.orderNumber,
          ofpOrderExternalId: order.externalId,
          correlatedAt: new Date().toISOString(),
        },
        ...(order.venda != null ? { value: order.venda } : {}),
      },
    });

    if (wonStage && card.stageId !== wonStage.id) {
      await this.pipelines.moveCard(card.id, organizationId, {
        toStageId: wonStage.id,
        toIndex: 0,
      } as any);
    }

    this.logger.log(
      `reconciliação: pedido ${order.externalId} vinculado ao card ${card.id}`,
    );
    return { linked: true, cardId: card.id, orderExternalId: order.externalId };
  }
}
