import { Injectable } from '@nestjs/common';
import { AttributionRepository, LeadsByAdRow, MediaByAdRow, WonByAdRow } from './attribution.repository';

export interface AttributionRow {
  adId: string;
  adName: string | null;
  campaignName: string | null;
  spend: number;
  leads: number;
  deals: number;
  revenue: number;
  cpl: number | null;
  roas: number | null;
}

export interface UnattributedBucket {
  leads: number;
  deals: number;
  revenue: number;
  /** Nunca um número: não existe "gasto não-atribuído", só leads sem anúncio identificado. */
  spend: null;
}

export interface CoverageStats {
  leadsTotal: number;
  leadsWithAdId: number;
  pct: number;
}

export interface AttributionResult {
  rows: AttributionRow[];
  unattributed: UnattributedBucket;
  coverage: CoverageStats;
}

export interface CreativeRow extends AttributionRow {
  impressions: number;
  ctr: number | null;
}

/** Divisão segura: denominador zero (ou negativo) vira `null`, nunca `NaN`/`Infinity`. */
function safeDivide(numerator: number, denominator: number, multiplier = 1): number | null {
  if (!denominator) return null;
  return (numerator / denominator) * multiplier;
}

/**
 * Ordena CPL ascendente com `null` sempre por último — tratar `null` como
 * zero colocaria o pior criativo (gasto sem nenhum lead) no topo do ranking.
 */
function compareCplAscendingNullsLast(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/**
 * Camada de atribuição lead → anúncio → venda.
 *
 * Sem rateio: cada `AttributionRow` só carrega os leads e vendas que
 * bateram por `adId`. O que não bateu (post orgânico, contato apagado,
 * ~17% dos leads sem `ctwa_clid` desde a mudança da Meta sob PMP) vai para
 * `unattributed` — nunca dividido proporcionalmente entre os anúncios.
 */
@Injectable()
export class AttributionService {
  constructor(private readonly repository: AttributionRepository) {}

  async getAttribution(organizationId: string, from: Date, to: Date): Promise<AttributionResult> {
    const [leadsRows, wonRows, mediaRows, coverageTotals] = await Promise.all([
      this.repository.leadsByAd(organizationId, from, to),
      this.repository.wonByAd(organizationId, from, to),
      this.repository.mediaByAd(organizationId, from, to),
      this.repository.coverageTotals(organizationId, from, to),
    ]);

    const rows = this.buildRows(leadsRows, wonRows, mediaRows).sort((a, b) => b.revenue - a.revenue);

    const unattributed: UnattributedBucket = {
      leads: coverageTotals.leadsTotal - coverageTotals.leadsWithAdId,
      deals: coverageTotals.unattributedDeals,
      revenue: coverageTotals.unattributedRevenue,
      spend: null,
    };

    const coverage: CoverageStats = {
      leadsTotal: coverageTotals.leadsTotal,
      leadsWithAdId: coverageTotals.leadsWithAdId,
      pct: safeDivide(coverageTotals.leadsWithAdId, coverageTotals.leadsTotal, 100) ?? 0,
    };

    return { rows, unattributed, coverage };
  }

  /** Mesmo conjunto de `getAttribution`, com `ctr`/`impressions`, ordenado por CPL ascendente. */
  async getCreatives(organizationId: string, from: Date, to: Date): Promise<CreativeRow[]> {
    const [leadsRows, wonRows, mediaRows] = await Promise.all([
      this.repository.leadsByAd(organizationId, from, to),
      this.repository.wonByAd(organizationId, from, to),
      this.repository.mediaByAd(organizationId, from, to),
    ]);

    const mediaByAd = new Map(mediaRows.map((row) => [row.adId, row]));
    const rows = this.buildRows(leadsRows, wonRows, mediaRows);

    const creatives: CreativeRow[] = rows.map((row) => {
      const media = mediaByAd.get(row.adId);
      const impressions = media?.impressions ?? 0;
      const clicks = media?.clicks ?? 0;
      return {
        ...row,
        impressions,
        ctr: safeDivide(clicks, impressions, 100),
      };
    });

    return creatives.sort((a, b) => compareCplAscendingNullsLast(a.cpl, b.cpl));
  }

  /** Junta leads + vendas + mídia pela união dos `adId`. Nenhuma fonte reparte valor para outro `adId`. */
  private buildRows(leadsRows: LeadsByAdRow[], wonRows: WonByAdRow[], mediaRows: MediaByAdRow[]): AttributionRow[] {
    const leadsByAd = new Map(leadsRows.map((row) => [row.adId, row.leads]));
    const wonByAd = new Map(wonRows.map((row) => [row.adId, row]));
    const mediaByAd = new Map(mediaRows.map((row) => [row.adId, row]));

    const adIds = new Set([...leadsByAd.keys(), ...wonByAd.keys(), ...mediaByAd.keys()]);

    return Array.from(adIds).map((adId) => {
      const media = mediaByAd.get(adId);
      const won = wonByAd.get(adId);
      const leads = leadsByAd.get(adId) ?? 0;
      const deals = won?.deals ?? 0;
      const revenue = won?.revenue ?? 0;
      const spend = media?.spend ?? 0;

      return {
        adId,
        adName: media?.adName ?? null,
        campaignName: media?.campaignName ?? null,
        spend,
        leads,
        deals,
        revenue,
        cpl: safeDivide(spend, leads),
        roas: safeDivide(revenue, spend),
      };
    });
  }
}
