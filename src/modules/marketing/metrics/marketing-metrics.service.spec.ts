import { AdConnectionStatus } from '@prisma/client';
import { MarketingMetricsService } from './marketing-metrics.service';
import { HealthGoals, HealthIndicator } from './health-indicators.service';
import {
  CrmTotals,
  ConnectionState,
  DailyLeadsRow,
  DailySpendRow,
  MediaAggregate,
} from './marketing.repository';

/** Período inteiramente no passado (7 dias), estável para sempre: nunca
 * deixa de ser passado, então `timePct`/`projectedSpend` ficam determinísticos
 * sem precisar mockar o relógio. */
const FROM = new Date('2026-01-01T00:00:00.000Z');
const TO = new Date('2026-01-07T00:00:00.000Z'); // 7 dias, ambos os extremos inclusos

/** Período inteiramente no futuro: nenhum dia decorrido ainda. */
const FUTURE_FROM = new Date('2099-01-01T00:00:00.000Z');
const FUTURE_TO = new Date('2099-01-07T00:00:00.000Z');

const ZERO_MEDIA: MediaAggregate = {
  spend: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  linkClicks: 0,
  landingPageViews: 0,
  currencies: [],
};

const ZERO_CRM: CrmTotals = { leads: 0, wonDeals: 0, wonRevenue: 0 };

const CONNECTED: ConnectionState = {
  hasConnection: true,
  lastSyncAt: new Date('2026-01-08T05:10:00.000Z'),
  brokenConnection: null,
};

/** Conexão existe mas o token morreu — o pior caso: dado plausível e velho. */
const CONNECTED_BROKEN: ConnectionState = {
  hasConnection: true,
  lastSyncAt: new Date('2026-01-02T05:10:00.000Z'),
  brokenConnection: {
    status: AdConnectionStatus.INVALID_TOKEN,
    accountName: 'CA Kleber',
    lastSyncError: 'Session has expired',
  },
};

const NOT_CONNECTED: ConnectionState = {
  hasConnection: false,
  lastSyncAt: null,
  brokenConnection: null,
};

const FAKE_INDICATORS: HealthIndicator[] = [
  { key: 'cpl', label: 'Custo por lead', value: null, target: null, color: 'grey', format: 'currency' },
];

function makeRepository(overrides: {
  aggregateMedia?: MediaAggregate;
  dailySpend?: DailySpendRow[];
  dailyLeads?: DailyLeadsRow[];
  crmTotals?: CrmTotals;
  connectionState?: ConnectionState;
} = {}) {
  return {
    aggregateMedia: jest.fn(async () => overrides.aggregateMedia ?? ZERO_MEDIA),
    dailySpend: jest.fn(async () => overrides.dailySpend ?? []),
    dailyLeads: jest.fn(async () => overrides.dailyLeads ?? []),
    crmTotals: jest.fn(async () => overrides.crmTotals ?? ZERO_CRM),
    connectionState: jest.fn(async () => overrides.connectionState ?? CONNECTED),
  };
}

function makeHealthIndicators(indicators: HealthIndicator[] = FAKE_INDICATORS) {
  return { buildIndicators: jest.fn((_input: any) => indicators) };
}

function build(overrides: Parameters<typeof makeRepository>[0] = {}, indicators?: HealthIndicator[]) {
  const repository = makeRepository(overrides);
  const healthIndicators = makeHealthIndicators(indicators);
  const service = new MarketingMetricsService(repository as any, healthIndicators as any);
  return { service, repository, healthIndicators };
}

const ORG = 'org-1';

describe('MarketingMetricsService', () => {
  describe('getOverview', () => {
    it('caminho feliz: calcula cada valor derivado a partir da mídia e do CRM', async () => {
      const { service, healthIndicators } = build({
        aggregateMedia: {
          spend: 700,
          impressions: 10000,
          reach: 5000,
          clicks: 200,
          linkClicks: 150,
          landingPageViews: 100,
          currencies: ['BRL'],
        },
        crmTotals: { leads: 70, wonDeals: 7, wonRevenue: 3500 },
      });

      const overview = await service.getOverview(ORG, FROM, TO, {
        targetCpl: null,
        targetCtrPct: null,
        targetLeadsPerDay: null,
        targetFrequencyMax: null,
        targetConversionPct: null,
        monthlyBudget: 1000,
      });

      expect(overview.media.spend).toBe(700);
      expect(overview.media.impressions).toBe(10000);
      expect(overview.media.reach).toBe(5000);
      expect(overview.media.clicks).toBe(200);
      expect(overview.media.linkClicks).toBe(150);
      expect(overview.media.landingPageViews).toBe(100);
      expect(overview.media.ctrPct).toBeCloseTo((200 / 10000) * 100); // 2
      expect(overview.media.frequency).toBeCloseTo(10000 / 5000); // 2
      expect(overview.media.currency).toBe('BRL');

      expect(overview.crm).toEqual({ leads: 70, wonDeals: 7, wonRevenue: 3500 });

      expect(overview.derived.cpl).toBeCloseTo(700 / 70); // 10
      expect(overview.derived.conversionPct).toBeCloseTo((7 / 70) * 100); // 10
      expect(overview.derived.roiPct).toBeCloseTo(((3500 - 700) / 700) * 100); // 400
      expect(overview.derived.leadsPerDay).toBeCloseTo(70 / 7); // 7 dias no período

      // Período inteiramente no passado -> mês (período) 100% decorrido.
      expect(overview.derived.budgetPace).not.toBeNull();
      expect(overview.derived.budgetPace!.timePct).toBeCloseTo(100);
      expect(overview.derived.budgetPace!.spentPct).toBeCloseTo((700 / 1000) * 100); // 70

      // Com o período 100% decorrido, a média diária projetada bate com o gasto real.
      expect(overview.derived.projectedSpend).toBeCloseTo(700);

      expect(overview.hasConnection).toBe(true);
      expect(overview.lastSyncAt).toEqual(CONNECTED.lastSyncAt);
      expect(overview.currencyMismatch).toBe(false);

      // O serviço não reimplementa a regra do farol — repassa os valores derivados.
      expect(healthIndicators.buildIndicators).toHaveBeenCalledTimes(1);
      const input = healthIndicators.buildIndicators.mock.calls[0][0];
      expect(input.cpl).toBeCloseTo(overview.derived.cpl!);
      expect(input.ctrPct).toBeCloseTo(overview.media.ctrPct!);
      expect(input.leadsPerDay).toBeCloseTo(overview.derived.leadsPerDay!);
      expect(input.frequency).toBeCloseTo(overview.media.frequency!);
      expect(input.conversionPct).toBeCloseTo(overview.derived.conversionPct!);
      expect(input.budgetPace).toEqual(overview.derived.budgetPace);
      expect(input.goals).toEqual({
        targetCpl: null,
        targetCtrPct: null,
        targetLeadsPerDay: null,
        targetFrequencyMax: null,
        targetConversionPct: null,
        monthlyBudget: 1000,
      });
      expect(overview.indicators).toBe(FAKE_INDICATORS);
    });

    it('zero leads -> cpl e conversionPct nulos, nunca Infinity/NaN', async () => {
      const { service } = build({
        aggregateMedia: { ...ZERO_MEDIA, spend: 500, impressions: 100, clicks: 10, reach: 50 },
        crmTotals: { leads: 0, wonDeals: 0, wonRevenue: 0 },
      });

      const overview = await service.getOverview(ORG, FROM, TO);

      expect(overview.derived.cpl).toBeNull();
      expect(overview.derived.conversionPct).toBeNull();
      expect(Number.isFinite(overview.derived.cpl as any)).toBe(false);
      // leadsPerDay ainda é computável (0 leads / dias do período = 0), não é o caso de divisão por zero.
      expect(overview.derived.leadsPerDay).toBe(0);
      expect(overview.derived.leadsPerDay).not.toBeNaN();
    });

    it('zero gasto -> roiPct nulo', async () => {
      const { service } = build({
        aggregateMedia: { ...ZERO_MEDIA, spend: 0 },
        crmTotals: { leads: 10, wonDeals: 2, wonRevenue: 1000 },
      });

      const overview = await service.getOverview(ORG, FROM, TO);

      expect(overview.derived.roiPct).toBeNull();
    });

    it('zero impressoes -> ctrPct nulo; zero reach -> frequency nulo', async () => {
      const { service } = build({
        aggregateMedia: { ...ZERO_MEDIA, spend: 100, impressions: 0, reach: 0, clicks: 0 },
      });

      const overview = await service.getOverview(ORG, FROM, TO);

      expect(overview.media.ctrPct).toBeNull();
      expect(overview.media.frequency).toBeNull();
    });

    it('leadsPerDay conta os dois extremos do periodo (01 a 07 = 7 dias, nao 6)', async () => {
      const { service } = build({
        crmTotals: { leads: 14, wonDeals: 0, wonRevenue: 0 },
      });

      const overview = await service.getOverview(ORG, FROM, TO);

      expect(overview.derived.leadsPerDay).toBeCloseTo(14 / 7);
    });

    it('sem nenhuma conexao -> hasConnection false, tudo zerado/nulo, sem lancar', async () => {
      const { service, repository } = build({
        connectionState: NOT_CONNECTED,
        // Mesmo se essas fontes tivessem dado, o estado vazio nao deve refleti-las.
        crmTotals: { leads: 999, wonDeals: 50, wonRevenue: 99999 },
        aggregateMedia: { ...ZERO_MEDIA, spend: 12345, impressions: 500, reach: 100, clicks: 20 },
      });

      const result = await service.getOverview(ORG, FROM, TO);

      expect(result.hasConnection).toBe(false);
      expect(result.lastSyncAt).toBeNull();
      expect(result.media).toEqual({
        spend: 0,
        impressions: 0,
        reach: 0,
        clicks: 0,
        linkClicks: 0,
        landingPageViews: 0,
        ctrPct: null,
        frequency: null,
        currency: 'BRL',
      });
      expect(result.crm).toEqual({ leads: 0, wonDeals: 0, wonRevenue: 0 });
      expect(result.derived).toEqual({
        cpl: null,
        conversionPct: null,
        roiPct: null,
        leadsPerDay: null,
        budgetPace: null,
        projectedSpend: null,
      });
      expect(result.currencyMismatch).toBe(false);
      expect(repository.aggregateMedia).not.toHaveBeenCalled();
      expect(repository.crmTotals).not.toHaveBeenCalled();
    });

    it('currencyMismatch verdadeiro quando ha moeda diferente de BRL', async () => {
      const { service } = build({
        aggregateMedia: { ...ZERO_MEDIA, currencies: ['BRL', 'USD'] },
      });
      const overview = await service.getOverview(ORG, FROM, TO);
      expect(overview.currencyMismatch).toBe(true);
    });

    it('currencyMismatch falso quando so ha BRL', async () => {
      const { service } = build({ aggregateMedia: { ...ZERO_MEDIA, currencies: ['BRL'] } });
      const overview = await service.getOverview(ORG, FROM, TO);
      expect(overview.currencyMismatch).toBe(false);
    });

    it('currencyMismatch falso quando nao ha nenhuma moeda no periodo', async () => {
      const { service } = build({ aggregateMedia: { ...ZERO_MEDIA, currencies: [] } });
      const overview = await service.getOverview(ORG, FROM, TO);
      expect(overview.currencyMismatch).toBe(false);
      expect(overview.media.currency).toBe('BRL');
    });

    it('budgetPace nulo quando nao ha monthlyBudget configurado', async () => {
      const { service } = build({ aggregateMedia: { ...ZERO_MEDIA, spend: 500 } });
      const overview = await service.getOverview(ORG, FROM, TO, {
        targetCpl: null,
        targetCtrPct: null,
        targetLeadsPerDay: null,
        targetFrequencyMax: null,
        targetConversionPct: null,
        monthlyBudget: null,
      });
      expect(overview.derived.budgetPace).toBeNull();
    });

    it('projectedSpend nulo quando o periodo ainda nao comecou (zero dias decorridos)', async () => {
      const { service } = build({ aggregateMedia: { ...ZERO_MEDIA, spend: 100 } });
      const overview = await service.getOverview(ORG, FUTURE_FROM, FUTURE_TO);
      expect(overview.derived.projectedSpend).toBeNull();
    });

    it('goals omitido (chamada so com organizationId/from/to) nao lanca e usa metas nulas', async () => {
      const { service, healthIndicators } = build();
      await service.getOverview(ORG, FROM, TO);
      const input = healthIndicators.buildIndicators.mock.calls[0][0];
      expect(input.goals).toBeNull();
    });
  });

  describe('getDailySeries', () => {
    it('preenche com zero os dias sem gasto e sem lead (sem buracos no grafico)', async () => {
      const { service } = build({
        dailySpend: [
          { date: '2026-01-01', spend: 100 },
          { date: '2026-01-03', spend: 50 },
        ],
        dailyLeads: [
          { date: '2026-01-02', leads: 4 },
        ],
      });

      const series = await service.getDailySeries(ORG, FROM, TO);

      expect(series).toHaveLength(7); // 01 a 07, ambos inclusos
      expect(series.map((p: { date: string }) => p.date)).toEqual([
        '2026-01-01',
        '2026-01-02',
        '2026-01-03',
        '2026-01-04',
        '2026-01-05',
        '2026-01-06',
        '2026-01-07',
      ]);
      expect(series[0]).toEqual({ date: '2026-01-01', spend: 100, leads: 0 });
      expect(series[1]).toEqual({ date: '2026-01-02', spend: 0, leads: 4 });
      expect(series[2]).toEqual({ date: '2026-01-03', spend: 50, leads: 0 });
      expect(series[3]).toEqual({ date: '2026-01-04', spend: 0, leads: 0 });
    });
  });
  describe('conexao quebrada', () => {
    it('expoe a conexao quebrada para a tela poder avisar', async () => {
      // O pior estado possivel: o painel mostra o historico inteiro, plausivel
      // e velho, sem nenhum sinal de que parou de atualizar.
      const { service } = build({ connectionState: CONNECTED_BROKEN });
      const overview = await service.getOverview(ORG, FROM, TO);

      expect(overview.hasConnection).toBe(true);
      expect(overview.brokenConnection).toMatchObject({
        status: AdConnectionStatus.INVALID_TOKEN,
        lastSyncError: 'Session has expired',
      });
    });

    it('conexao saudavel nao levanta aviso', async () => {
      const { service } = build({ connectionState: CONNECTED });
      const overview = await service.getOverview(ORG, FROM, TO);
      expect(overview.brokenConnection).toBeNull();
    });
  });
});
