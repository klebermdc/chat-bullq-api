import { AttributionService } from './attribution.service';
import { CoverageTotals, LeadsByAdRow, MediaByAdRow, WonByAdRow } from './attribution.repository';

/** Período qualquer — os testes não dependem do relógio. */
const FROM = new Date('2026-01-01T00:00:00.000Z');
const TO = new Date('2026-01-07T23:59:59.999Z');

const ZERO_COVERAGE: CoverageTotals = {
  leadsTotal: 0,
  leadsWithAdId: 0,
  unattributedDeals: 0,
  unattributedRevenue: 0,
};

function makeRepository(
  overrides: {
    leadsByAd?: LeadsByAdRow[];
    wonByAd?: WonByAdRow[];
    coverageTotals?: CoverageTotals;
    mediaByAd?: MediaByAdRow[];
  } = {},
) {
  return {
    leadsByAd: jest.fn(async () => overrides.leadsByAd ?? []),
    wonByAd: jest.fn(async () => overrides.wonByAd ?? []),
    coverageTotals: jest.fn(async () => overrides.coverageTotals ?? ZERO_COVERAGE),
    mediaByAd: jest.fn(async () => overrides.mediaByAd ?? []),
  };
}

function build(overrides: Parameters<typeof makeRepository>[0] = {}) {
  const repository = makeRepository(overrides);
  const service = new AttributionService(repository as any);
  return { service, repository };
}

const ORG = 'org-1';

describe('AttributionService', () => {
  describe('getAttribution', () => {
    it('caminho feliz: cada linha só carrega o que bateu por adId, sem ratear receita', async () => {
      const { service } = build({
        leadsByAd: [
          { adId: 'ad-1', leads: 10 },
          { adId: 'ad-2', leads: 20 },
        ],
        wonByAd: [{ adId: 'ad-1', deals: 2, revenue: 1000 }],
        mediaByAd: [
          { adId: 'ad-1', adName: 'Anúncio 1', campaignName: 'Campanha A', spend: 100, impressions: 1000, clicks: 50 },
          { adId: 'ad-2', adName: 'Anúncio 2', campaignName: 'Campanha A', spend: 200, impressions: 2000, clicks: 20 },
          { adId: 'ad-3', adName: 'Anúncio 3', campaignName: 'Campanha B', spend: 50, impressions: 500, clicks: 5 },
        ],
      });

      const result = await service.getAttribution(ORG, FROM, TO);

      expect(result.rows).toHaveLength(3);
      expect(result.rows[0]).toEqual({
        adId: 'ad-1',
        adName: 'Anúncio 1',
        campaignName: 'Campanha A',
        spend: 100,
        leads: 10,
        deals: 2,
        revenue: 1000,
        cpl: 10, // 100 / 10
        roas: 10, // 1000 / 100
      });
      // ad-2 não teve venda: deals/revenue zerados, NUNCA herdados de ad-1 por rateio.
      expect(result.rows[1]).toMatchObject({ adId: 'ad-2', spend: 200, leads: 20, deals: 0, revenue: 0, cpl: 10, roas: 0 });
      // ad-3 teve gasto mas nenhum lead bateu — ainda aparece, cpl nulo (não zero, não Infinity).
      expect(result.rows[2]).toMatchObject({ adId: 'ad-3', spend: 50, leads: 0, deals: 0, revenue: 0, cpl: null, roas: 0 });
    });

    it('ordena por receita decrescente por padrão', async () => {
      const { service } = build({
        mediaByAd: [
          { adId: 'ad-low', adName: null, campaignName: null, spend: 10, impressions: 0, clicks: 0 },
          { adId: 'ad-high', adName: null, campaignName: null, spend: 10, impressions: 0, clicks: 0 },
        ],
        wonByAd: [
          { adId: 'ad-low', deals: 1, revenue: 100 },
          { adId: 'ad-high', deals: 1, revenue: 900 },
        ],
      });

      const result = await service.getAttribution(ORG, FROM, TO);

      expect(result.rows.map((r) => r.adId)).toEqual(['ad-high', 'ad-low']);
    });

    it('zero leads -> cpl nulo; zero gasto -> roas nulo; nunca NaN/Infinity', async () => {
      const { service } = build({
        leadsByAd: [{ adId: 'ad-free-lead', leads: 5 }],
        mediaByAd: [{ adId: 'ad-spent', adName: null, campaignName: null, spend: 300, impressions: 0, clicks: 0 }],
      });

      const result = await service.getAttribution(ORG, FROM, TO);
      const byId = new Map(result.rows.map((r) => [r.adId, r]));

      const spentNoLeads = byId.get('ad-spent')!;
      expect(spentNoLeads.cpl).toBeNull();
      expect(Number.isFinite(spentNoLeads.cpl as any)).toBe(false);

      // Anuncio com lead mas SEM linha de gasto ingerida: custo desconhecido,
      // nao zero. Devolver 0 aqui fabricaria "o lead mais barato do periodo".
      const leadNoSpend = byId.get('ad-free-lead')!;
      expect(leadNoSpend.spend).toBeNull();
      expect(leadNoSpend.cpl).toBeNull();
      expect(leadNoSpend.roas).toBeNull();
    });

    it('distingue "sem linha de gasto" de "gastou zero de verdade"', async () => {
      const { service } = build({
        leadsByAd: [
          { adId: 'ad-sem-dado', leads: 5 },
          { adId: 'ad-gastou-zero', leads: 4 },
        ],
        mediaByAd: [
          // Linha existe e o gasto e zero de fato — CPL zero e verdade aqui.
          { adId: 'ad-gastou-zero', adName: null, campaignName: null, spend: 0, impressions: 0, clicks: 0 },
        ],
      });

      const byId = new Map(
        (await service.getAttribution(ORG, FROM, TO)).rows.map((r) => [r.adId, r]),
      );

      expect(byId.get('ad-sem-dado')!.spend).toBeNull();
      expect(byId.get('ad-sem-dado')!.cpl).toBeNull();

      expect(byId.get('ad-gastou-zero')!.spend).toBe(0);
      expect(byId.get('ad-gastou-zero')!.cpl).toBe(0);
    });

    it('anuncio sem linha de gasto NAO encabeca o ranking de criativos', async () => {
      // O bug que isto trava: com cpl 0 fabricado, o anuncio de custo
      // desconhecido ganhava a medalha de ouro de "lead mais barato".
      const { service } = build({
        leadsByAd: [
          { adId: 'ad-sem-dado', leads: 10 },
          { adId: 'ad-barato', leads: 10 },
        ],
        mediaByAd: [
          { adId: 'ad-barato', adName: null, campaignName: null, spend: 50, impressions: 0, clicks: 0 },
        ],
      });

      const creatives = await service.getCreatives(ORG, FROM, TO);

      expect(creatives[0].adId).toBe('ad-barato');
      expect(creatives[creatives.length - 1].adId).toBe('ad-sem-dado');
    });

    it('balde não-atribuído sempre existe, mesmo com tudo zerado, e spend é sempre nulo', async () => {
      const { service } = build();

      const result = await service.getAttribution(ORG, FROM, TO);

      expect(result.unattributed).toEqual({ leads: 0, deals: 0, revenue: 0, spend: null });
      expect(result.rows).toEqual([]);
    });

    it('balde não-atribuído reflete o que o repositório aponta como sem anúncio (post orgânico, contato apagado)', async () => {
      // Estes casos (ctwaSourceType='post', Card.contactId nulo) são filtrados
      // dentro do repositório — o service só precisa repassar os totais sem alterar.
      const { service } = build({
        coverageTotals: { leadsTotal: 50, leadsWithAdId: 30, unattributedDeals: 3, unattributedRevenue: 450 },
      });

      const result = await service.getAttribution(ORG, FROM, TO);

      expect(result.unattributed).toEqual({ leads: 20, deals: 3, revenue: 450, spend: null });
    });

    it('coverage.pct = leadsWithAdId/leadsTotal*100', async () => {
      const { service } = build({
        coverageTotals: { leadsTotal: 50, leadsWithAdId: 30, unattributedDeals: 0, unattributedRevenue: 0 },
      });

      const result = await service.getAttribution(ORG, FROM, TO);

      expect(result.coverage).toEqual({ leadsTotal: 50, leadsWithAdId: 30, pct: 60 });
    });

    it('leadsTotal zero -> coverage.pct é 0, nunca null nem NaN', async () => {
      const { service } = build({ coverageTotals: ZERO_COVERAGE });

      const result = await service.getAttribution(ORG, FROM, TO);

      expect(result.coverage.pct).toBe(0);
      expect(result.coverage.pct).not.toBeNull();
      expect(result.coverage.pct).not.toBeNaN();
    });
  });

  describe('getCreatives', () => {
    it('mesmo conjunto de getAttribution, com ctr e impressions calculados a partir da mídia', async () => {
      const { service } = build({
        leadsByAd: [{ adId: 'ad-1', leads: 10 }],
        mediaByAd: [
          { adId: 'ad-1', adName: 'Anúncio 1', campaignName: 'Campanha A', spend: 100, impressions: 1000, clicks: 50 },
        ],
      });

      const [creative] = await service.getCreatives(ORG, FROM, TO);

      expect(creative).toMatchObject({ adId: 'ad-1', impressions: 1000, ctr: 5 }); // 50/1000*100
    });

    it('ordena por CPL ascendente', async () => {
      const { service } = build({
        leadsByAd: [
          { adId: 'ad-cpl-20', leads: 5 },
          { adId: 'ad-cpl-5', leads: 20 },
        ],
        mediaByAd: [
          { adId: 'ad-cpl-20', adName: null, campaignName: null, spend: 100, impressions: 100, clicks: 1 },
          { adId: 'ad-cpl-5', adName: null, campaignName: null, spend: 100, impressions: 100, clicks: 1 },
        ],
      });

      const creatives = await service.getCreatives(ORG, FROM, TO);

      expect(creatives.map((c) => c.adId)).toEqual(['ad-cpl-5', 'ad-cpl-20']);
    });

    it('anúncio com gasto e CPL nulo (zero leads) vai para o final, nunca para o topo', async () => {
      // Ordem de inserção proposital: o anúncio de cpl nulo entra no merge
      // ANTES do anúncio com cpl definido, para provar que o critério de
      // ordenação é o valor de cpl, não a ordem de chegada — tratar null como
      // 0 aqui colocaria o pior criativo no topo do ranking.
      const { service } = build({
        leadsByAd: [{ adId: 'ad-with-leads', leads: 8 }],
        mediaByAd: [
          { adId: 'ad-null-cpl', adName: null, campaignName: null, spend: 80, impressions: 800, clicks: 8 },
          { adId: 'ad-with-leads', adName: null, campaignName: null, spend: 40, impressions: 400, clicks: 4 },
        ],
      });

      const creatives = await service.getCreatives(ORG, FROM, TO);

      expect(creatives.map((c) => c.adId)).toEqual(['ad-with-leads', 'ad-null-cpl']);
      expect(creatives[creatives.length - 1].cpl).toBeNull();
    });
  });
});
