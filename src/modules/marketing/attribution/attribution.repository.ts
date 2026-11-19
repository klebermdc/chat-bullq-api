import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { countLeads } from '../metrics/lead-count';
import { LAST_TOUCH_FOR_CARD, touchesCte } from './attribution-touches.sql';

/** Nomes que vieram da UTM do site — usados quando o anúncio não tem linha de gasto. */
interface UtmNames {
  adName?: string | null;
  campaignName?: string | null;
}

export interface LeadsByAdRow extends UtmNames {
  adId: string;
  leads: number;
}

export interface WonByAdRow extends UtmNames {
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
 * `AdDailyStat.adId ← toque do contato (CTWA ou formulário do site) ← Card.contactId`.
 * Os toques vêm de `touchesCte` (ver `attribution-touches.sql.ts`).
 *
 * Nenhum método aqui reparte receita — cada linha só carrega o que bateu
 * por `adId`. Quem decide o que é "não atribuído" é o service, a partir de
 * `coverageTotals`.
 */
@Injectable()
export class AttributionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Leads por anúncio no período. Período pelo TOQUE (clique no anúncio ou
   * envio do formulário), não pela criação do contato: cliente antigo que
   * volta por um anúncio conta para ele. Contato com mais de um toque no
   * período conta uma vez, para o último.
   */
  async leadsByAd(organizationId: string, from: Date, to: Date): Promise<LeadsByAdRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ ad_id: string; ad_name: string | null; campaign_name: string | null; leads: bigint }>
    >(
      Prisma.sql`
        WITH ${touchesCte(organizationId)},
        latest AS (
          SELECT DISTINCT ON (t."contact_id") t."contact_id", t."ad_id", t."ad_name", t."campaign_name"
          FROM touches t
          WHERE t."at" >= ${from} AND t."at" <= ${to}
          ORDER BY t."contact_id", t."at" DESC
        )
        SELECT l."ad_id",
               MAX(l."ad_name") AS ad_name,
               MAX(l."campaign_name") AS campaign_name,
               COUNT(*)::bigint AS leads
        FROM latest l
        GROUP BY l."ad_id"
      `,
    );

    return rows.map((row) => ({
      adId: row.ad_id,
      adName: row.ad_name,
      campaignName: row.campaign_name,
      leads: Number(row.leads),
    }));
  }

  /**
   * Vendas ganhas no período, pelo último toque do contato do card.
   * SQL bruto porque o Prisma não agrupa por campo de relação nem faz
   * LATERAL. `organizationId`/`from`/`to` sempre via parâmetro; o literal
   * `'WON'` não é entrada externa.
   */
  async wonByAd(organizationId: string, from: Date, to: Date): Promise<WonByAdRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        ad_id: string;
        ad_name: string | null;
        campaign_name: string | null;
        deals: bigint;
        revenue: Prisma.Decimal | null;
      }>
    >(
      Prisma.sql`
        WITH ${touchesCte(organizationId)}
        SELECT t."ad_id",
               MAX(t."ad_name") AS ad_name,
               MAX(t."campaign_name") AS campaign_name,
               COUNT(*)::bigint AS deals,
               COALESCE(SUM(cd."value"), 0) AS revenue
        FROM "cards" cd
        CROSS JOIN LATERAL (${LAST_TOUCH_FOR_CARD}) t
        WHERE cd."organization_id" = ${organizationId}
          AND cd."status" = 'WON'
          AND cd."closed_at" >= ${from}
          AND cd."closed_at" <= ${to}
        GROUP BY t."ad_id"
      `,
    );

    return rows.map((row) => ({
      adId: row.ad_id,
      adName: row.ad_name,
      campaignName: row.campaign_name,
      deals: Number(row.deals),
      revenue: Number(row.revenue ?? 0),
    }));
  }

  /**
   * Totais para a cobertura e para o balde não-atribuído.
   *
   * `leadsTotal` usa a mesma definição de lead do card do painel
   * (`countLeads`). `leadsWithAdId` = contatos com toque de anúncio no
   * período. `unattributed*` = cards GANHO do período cujo contato foi
   * apagado/não existe ou não tem nenhum toque de anúncio — exatamente o
   * complemento de `wonByAd`.
   */
  async coverageTotals(organizationId: string, from: Date, to: Date): Promise<CoverageTotals> {
    const [leadsTotal, withAdRows, unattributedRows] = await Promise.all([
      countLeads(this.prisma, organizationId, from, to),
      this.prisma.$queryRaw<Array<{ contacts: bigint }>>(
        Prisma.sql`
          WITH ${touchesCte(organizationId)}
          SELECT COUNT(DISTINCT t."contact_id")::bigint AS contacts
          FROM touches t
          WHERE t."at" >= ${from} AND t."at" <= ${to}
        `,
      ),
      this.prisma.$queryRaw<Array<{ deals: bigint; revenue: Prisma.Decimal | null }>>(
        Prisma.sql`
          WITH ${touchesCte(organizationId)}
          SELECT COUNT(*)::bigint AS deals,
                 COALESCE(SUM(cd."value"), 0) AS revenue
          FROM "cards" cd
          WHERE cd."organization_id" = ${organizationId}
            AND cd."status" = 'WON'
            AND cd."closed_at" >= ${from}
            AND cd."closed_at" <= ${to}
            AND NOT EXISTS (SELECT 1 FROM touches t WHERE t."contact_id" = cd."contact_id")
        `,
      ),
    ]);

    const unattributed = unattributedRows[0];

    return {
      leadsTotal,
      leadsWithAdId: withAdRows[0] ? Number(withAdRows[0].contacts) : 0,
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
