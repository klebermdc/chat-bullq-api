import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

/**
 * `Contact.ctwaSourceType` também assume `'post'` (alcance orgânico). Um
 * `ctwaSourceId` de post não é um `adId` — comparar os dois sem este filtro
 * ou não bate com nada, ou pior, colide com um `adId` de mesmo valor.
 * Todo ponto deste arquivo que toca `ctwaSourceId` filtra por esta constante.
 */
const CTWA_SOURCE_TYPE_AD = 'ad';

export interface LeadsByAdRow {
  adId: string;
  leads: number;
}

export interface WonByAdRow {
  adId: string;
  deals: number;
  revenue: number;
}

export interface CoverageTotals {
  leadsTotal: number;
  leadsWithAdId: number;
  unattributedDeals: number;
  unattributedRevenue: number;
}

export interface MediaByAdRow {
  adId: string;
  adName: string | null;
  campaignName: string | null;
  spend: number;
  impressions: number;
  clicks: number;
}

/**
 * Camada fina sobre o Prisma para a cadeia de atribuição
 * `AdDailyStat.adId ← Contact.ctwaSourceId ← Card.contactId`.
 *
 * Nenhum método aqui reparte receita — cada linha só carrega o que bateu
 * por `adId`. Quem decide o que é "não atribuído" é o service, a partir de
 * `coverageTotals`.
 */
@Injectable()
export class AttributionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Leads do período agrupados por anúncio. Só `ctwaSourceType='ad'`. */
  async leadsByAd(organizationId: string, from: Date, to: Date): Promise<LeadsByAdRow[]> {
    const grouped = await this.prisma.contact.groupBy({
      by: ['ctwaSourceId'],
      where: {
        organizationId,
        deletedAt: null,
        createdAt: { gte: from, lte: to },
        ctwaSourceType: CTWA_SOURCE_TYPE_AD,
        ctwaSourceId: { not: null },
      },
      _count: { _all: true },
    });

    return grouped.map((row) => ({
      // O `where` acima garante `ctwaSourceId` não-nulo; o tipo gerado pelo
      // Prisma não reflete isso porque acompanha o tipo da coluna no schema.
      adId: row.ctwaSourceId as string,
      leads: row._count._all,
    }));
  }

  /**
   * Vendas ganhas no período, agrupadas pelo anúncio do contato do card.
   *
   * Join feito em SQL bruto porque o Prisma não agrupa por um campo de uma
   * relação (`card.contact.ctwaSourceId`). `organizationId`/`from`/`to` vão
   * sempre via parâmetro (`${}` do template do Prisma) — nunca concatenados.
   * O literal `'WON'` não é entrada externa; comparar um enum do Postgres a
   * um literal de texto no próprio SQL é o mesmo padrão já usado em
   * `conversations.repository.ts` (`mo.direction = 'OUTBOUND'`).
   */
  async wonByAd(organizationId: string, from: Date, to: Date): Promise<WonByAdRow[]> {
    const rows = await this.prisma.$queryRaw<Array<{ ad_id: string; deals: bigint; revenue: Prisma.Decimal | null }>>(
      Prisma.sql`
        SELECT c."ctwa_source_id" AS ad_id,
               COUNT(*)::bigint AS deals,
               COALESCE(SUM(cd."value"), 0) AS revenue
        FROM "cards" cd
        JOIN "contacts" c ON c."id" = cd."contact_id"
        WHERE cd."organization_id" = ${organizationId}
          AND cd."status" = 'WON'
          AND cd."closed_at" >= ${from}
          AND cd."closed_at" <= ${to}
          AND c."ctwa_source_type" = ${CTWA_SOURCE_TYPE_AD}
          AND c."ctwa_source_id" IS NOT NULL
        GROUP BY c."ctwa_source_id"
      `,
    );

    return rows.map((row) => ({
      adId: row.ad_id,
      deals: Number(row.deals),
      revenue: Number(row.revenue ?? 0),
    }));
  }

  /**
   * Totais para a cobertura e para o balde não-atribuído.
   *
   * `leadsTotal`/`leadsWithAdId` usam a mesma definição de lead do
   * `crm-reports` (Contact por `createdAt`, `deletedAt: null`).
   * `unattributedDeals`/`unattributedRevenue` são os cards GANHO do período
   * cujo contato foi apagado (`contactId` nulo), não veio de anúncio
   * (`ctwaSourceType` != 'ad') ou não tem `ctwaSourceId` — o `LEFT JOIN` com
   * `FILTER` cobre as três causas em uma única passada.
   */
  async coverageTotals(organizationId: string, from: Date, to: Date): Promise<CoverageTotals> {
    const [leadsTotal, leadsWithAdId, unattributedAgg] = await Promise.all([
      this.prisma.contact.count({
        where: { organizationId, deletedAt: null, createdAt: { gte: from, lte: to } },
      }),
      this.prisma.contact.count({
        where: {
          organizationId,
          deletedAt: null,
          createdAt: { gte: from, lte: to },
          ctwaSourceType: CTWA_SOURCE_TYPE_AD,
          ctwaSourceId: { not: null },
        },
      }),
      this.prisma.$queryRaw<Array<{ deals: bigint; revenue: Prisma.Decimal | null }>>(
        Prisma.sql`
          SELECT
            COUNT(*) FILTER (
              WHERE cd."contact_id" IS NULL
                 OR c."ctwa_source_type" IS DISTINCT FROM ${CTWA_SOURCE_TYPE_AD}
                 OR c."ctwa_source_id" IS NULL
            )::bigint AS deals,
            COALESCE(SUM(cd."value") FILTER (
              WHERE cd."contact_id" IS NULL
                 OR c."ctwa_source_type" IS DISTINCT FROM ${CTWA_SOURCE_TYPE_AD}
                 OR c."ctwa_source_id" IS NULL
            ), 0) AS revenue
          FROM "cards" cd
          LEFT JOIN "contacts" c ON c."id" = cd."contact_id"
          WHERE cd."organization_id" = ${organizationId}
            AND cd."status" = 'WON'
            AND cd."closed_at" >= ${from}
            AND cd."closed_at" <= ${to}
        `,
      ),
    ]);

    const unattributed = unattributedAgg[0];

    return {
      leadsTotal,
      leadsWithAdId,
      unattributedDeals: unattributed ? Number(unattributed.deals) : 0,
      unattributedRevenue: unattributed ? Number(unattributed.revenue ?? 0) : 0,
    };
  }

  /**
   * Gasto e métricas por anúncio no período. `adName`/`campaignName` vêm da
   * linha mais recente daquele `adId` no período — o nome muda ao longo do
   * tempo, e é o mais recente que a pessoa reconhece no Ads Manager hoje.
   */
  async mediaByAd(organizationId: string, from: Date, to: Date): Promise<MediaByAdRow[]> {
    const where: Prisma.AdDailyStatWhereInput = {
      organizationId,
      date: { gte: from, lte: to },
    };

    const [sums, latestRows] = await Promise.all([
      this.prisma.adDailyStat.groupBy({
        by: ['adId'],
        where,
        _sum: { spend: true, impressions: true, clicks: true },
      }),
      // `distinct` + `orderBy` composto: para cada `adId` (ordenado asc),
      // o Prisma mantém a primeira linha da ordenação — que é a de maior
      // `date` porque a segunda chave do orderBy é `date desc`.
      this.prisma.adDailyStat.findMany({
        where,
        distinct: ['adId'],
        orderBy: [{ adId: 'asc' }, { date: 'desc' }],
        select: { adId: true, adName: true, campaignName: true },
      }),
    ]);

    const namesByAd = new Map(latestRows.map((row) => [row.adId, row]));

    return sums.map((row) => {
      const names = namesByAd.get(row.adId);
      return {
        adId: row.adId,
        adName: names?.adName ?? null,
        campaignName: names?.campaignName ?? null,
        spend: Number(row._sum.spend ?? 0),
        impressions: row._sum.impressions ?? 0,
        clicks: row._sum.clicks ?? 0,
      };
    });
  }
}
