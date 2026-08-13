import { Injectable } from '@nestjs/common';
import { HealthGoals, HealthIndicator, HealthIndicatorsService } from './health-indicators.service';
import { MarketingRepository } from './marketing.repository';

const MS_PER_DAY = 86_400_000;

export interface MarketingOverview {
  media: {
    spend: number;
    impressions: number;
    reach: number;
    clicks: number;
    linkClicks: number;
    landingPageViews: number;
    ctrPct: number | null;
    frequency: number | null;
    currency: string;
  };
  crm: { leads: number; wonDeals: number; wonRevenue: number };
  derived: {
    cpl: number | null;
    conversionPct: number | null;
    roiPct: number | null;
    leadsPerDay: number | null;
    budgetPace: { spentPct: number; timePct: number } | null;
    projectedSpend: number | null;
  };
  indicators: HealthIndicator[];
  hasConnection: boolean;
  lastSyncAt: Date | null;
  currencyMismatch: boolean;
}

export interface DailySeriesPoint {
  date: string;
  spend: number;
  leads: number;
}

/** Trunca para meia-noite UTC do dia civil, para contar dias por diferença de calendário. */
function toUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Dias no período incluindo os dois extremos: 01 a 07 são 7 dias, não 6. */
function daysInclusive(from: Date, to: Date): number {
  return Math.round((toUtcDay(to) - toUtcDay(from)) / MS_PER_DAY) + 1;
}

/** Divisão seguro: denominador zero (ou negativo) vira `null`, nunca `NaN`/`Infinity`. */
function safeDivide(numerator: number, denominator: number, multiplier = 1): number | null {
  if (!denominator) return null;
  return (numerator / denominator) * multiplier;
}

const EMPTY_MEDIA: MarketingOverview['media'] = {
  spend: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  linkClicks: 0,
  landingPageViews: 0,
  ctrPct: null,
  frequency: null,
  currency: 'BRL',
};

const EMPTY_CRM: MarketingOverview['crm'] = { leads: 0, wonDeals: 0, wonRevenue: 0 };

const EMPTY_DERIVED: MarketingOverview['derived'] = {
  cpl: null,
  conversionPct: null,
  roiPct: null,
  leadsPerDay: null,
  budgetPace: null,
  projectedSpend: null,
};

@Injectable()
export class MarketingMetricsService {
  constructor(
    private readonly repository: MarketingRepository,
    private readonly healthIndicators: HealthIndicatorsService,
  ) {}

  /**
   * Painel do etapa. Nunca lança para "sem conexão" — a tela mostra o estado
   * vazio, não um toast de erro para uma situação perfeitamente normal.
   *
   * `goals` é opcional porque a configuração de metas (MarketingGoal) ainda
   * não tem tela própria; quando ausente, os seis indicadores voltam cinza
   * (ver HealthIndicatorsService), o que é o comportamento correto.
   */
  async getOverview(
    organizationId: string,
    from: Date,
    to: Date,
    goals: HealthGoals | null = null,
  ): Promise<MarketingOverview> {
    const connection = await this.repository.connectionState(organizationId);

    if (!connection.hasConnection) {
      return {
        media: EMPTY_MEDIA,
        crm: EMPTY_CRM,
        derived: EMPTY_DERIVED,
        indicators: this.healthIndicators.buildIndicators({
          cpl: null,
          ctrPct: null,
          leadsPerDay: null,
          frequency: null,
          conversionPct: null,
          budgetPace: null,
          goals,
        }),
        hasConnection: false,
        lastSyncAt: null,
        currencyMismatch: false,
      };
    }

    const [mediaAgg, crm] = await Promise.all([
      this.repository.aggregateMedia(organizationId, from, to),
      this.repository.crmTotals(organizationId, from, to),
    ]);

    const ctrPct = safeDivide(mediaAgg.clicks, mediaAgg.impressions, 100);
    const frequency = safeDivide(mediaAgg.impressions, mediaAgg.reach);
    const currency = mediaAgg.currencies.length === 1 ? mediaAgg.currencies[0] : 'BRL';
    const currencyMismatch = mediaAgg.currencies.some((c) => c !== 'BRL');

    const media: MarketingOverview['media'] = {
      spend: mediaAgg.spend,
      impressions: mediaAgg.impressions,
      reach: mediaAgg.reach,
      clicks: mediaAgg.clicks,
      linkClicks: mediaAgg.linkClicks,
      landingPageViews: mediaAgg.landingPageViews,
      ctrPct,
      frequency,
      currency,
    };

    const cpl = safeDivide(mediaAgg.spend, crm.leads);
    const conversionPct = safeDivide(crm.wonDeals, crm.leads, 100);
    const roiPct = safeDivide(crm.wonRevenue - mediaAgg.spend, mediaAgg.spend, 100);

    const totalDays = daysInclusive(from, to);
    const leadsPerDay = totalDays > 0 ? crm.leads / totalDays : null;

    const budgetPace = this.computeBudgetPace(mediaAgg.spend, from, to, goals?.monthlyBudget ?? null);
    const projectedSpend = this.computeProjectedSpend(mediaAgg.spend, from, to);

    const derived: MarketingOverview['derived'] = {
      cpl,
      conversionPct,
      roiPct,
      leadsPerDay,
      budgetPace,
      projectedSpend,
    };

    const indicators = this.healthIndicators.buildIndicators({
      cpl,
      ctrPct,
      leadsPerDay,
      frequency,
      conversionPct,
      budgetPace,
      goals,
    });

    return {
      media,
      crm,
      derived,
      indicators,
      hasConnection: true,
      lastSyncAt: connection.lastSyncAt,
      currencyMismatch,
    };
  }

  /** Série diária de gasto + leads, com os dias sem dado zero-preenchidos — sem buracos no gráfico. */
  async getDailySeries(organizationId: string, from: Date, to: Date): Promise<DailySeriesPoint[]> {
    const [spendRows, leadRows] = await Promise.all([
      this.repository.dailySpend(organizationId, from, to),
      this.repository.dailyLeads(organizationId, from, to),
    ]);

    const spendByDate = new Map(spendRows.map((r) => [r.date, r.spend]));
    const leadsByDate = new Map(leadRows.map((r) => [r.date, r.leads]));

    return this.enumerateDateKeys(from, to).map((date) => ({
      date,
      spend: spendByDate.get(date) ?? 0,
      leads: leadsByDate.get(date) ?? 0,
    }));
  }

  private enumerateDateKeys(from: Date, to: Date): string[] {
    const keys: string[] = [];
    const start = toUtcDay(from);
    const end = toUtcDay(to);
    for (let t = start; t <= end; t += MS_PER_DAY) {
      keys.push(new Date(t).toISOString().slice(0, 10));
    }
    return keys;
  }

  /**
   * Dias decorridos do período em relação a agora, sempre entre 0 e o total
   * de dias do período — nunca negativo, nunca além do próprio período.
   */
  private elapsedDays(from: Date, to: Date, totalDays: number): number {
    const nowDay = toUtcDay(new Date());
    const fromDay = toUtcDay(from);
    const toDay = toUtcDay(to);
    if (nowDay < fromDay) return 0;
    if (nowDay >= toDay) return totalDays;
    return Math.round((nowDay - fromDay) / MS_PER_DAY) + 1;
  }

  /** `null` sem meta de orçamento configurada (nula ou zero — mesma regra do farol). */
  private computeBudgetPace(
    spend: number,
    from: Date,
    to: Date,
    monthlyBudget: number | null,
  ): { spentPct: number; timePct: number } | null {
    if (!monthlyBudget) return null;
    const totalDays = daysInclusive(from, to);
    if (totalDays <= 0) return null;

    const elapsedDays = this.elapsedDays(from, to, totalDays);
    const spentPct = Math.max(0, (spend / monthlyBudget) * 100);
    const timePct = Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100));
    return { spentPct, timePct };
  }

  /** Projeta o gasto do período todo a partir da média diária já observada. */
  private computeProjectedSpend(spend: number, from: Date, to: Date): number | null {
    const totalDays = daysInclusive(from, to);
    if (totalDays <= 0) return null;

    const elapsedDays = this.elapsedDays(from, to, totalDays);
    if (elapsedDays <= 0) return null;

    return (spend / elapsedDays) * totalDays;
  }
}
