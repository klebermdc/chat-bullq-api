import { mapInsightRow } from './insights.mapper';

const CTX = { organizationId: 'org-1', connectionId: 'conn-1', syncedAt: new Date('2026-08-12T05:10:00Z') };

const FULL_ROW = {
  date_start: '2026-08-10',
  date_stop: '2026-08-10',
  ad_id: '123',
  ad_name: 'Criativo A',
  adset_id: '456',
  adset_name: 'Publico Quente',
  campaign_id: '789',
  campaign_name: 'Campanha Agosto',
  account_currency: 'BRL',
  spend: '123.45',
  impressions: '10000',
  reach: '8000',
  clicks: '300',
  inline_link_clicks: '250',
  frequency: '1.25',
  ctr: '3.0',
  cpc: '0.41',
  actions: [
    { action_type: 'landing_page_view', value: '180' },
    { action_type: 'lead', value: '12' },
  ],
};

describe('mapInsightRow', () => {
  it('converte a linha completa', () => {
    const row = mapInsightRow(FULL_ROW, CTX);
    expect(row).toMatchObject({
      organizationId: 'org-1',
      connectionId: 'conn-1',
      adId: '123',
      adName: 'Criativo A',
      adsetId: '456',
      campaignName: 'Campanha Agosto',
      currency: 'BRL',
      spend: 123.45,
      impressions: 10000,
      reach: 8000,
      clicks: 300,
      linkClicks: 250,
      landingPageViews: 180,
      frequency: 1.25,
      ctr: 3,
      cpc: 0.41,
    });
    expect(row.date.toISOString().slice(0, 10)).toBe('2026-08-10');
    expect(row.syncedAt).toEqual(CTX.syncedAt);
  });

  it('preserva o array actions cru', () => {
    const row = mapInsightRow(FULL_ROW, CTX);
    expect(row.actions).toEqual(FULL_ROW.actions);
  });

  it('usa zero quando a metrica nao veio', () => {
    const row = mapInsightRow(
      { date_start: '2026-08-10', ad_id: '123', account_currency: 'BRL' },
      CTX,
    );
    expect(row).toMatchObject({
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      linkClicks: 0,
      landingPageViews: 0,
      frequency: 0,
      ctr: 0,
      cpc: 0,
    });
    expect(row.actions).toBeNull();
  });

  it('usa zero para landing_page_view quando actions nao tem esse tipo', () => {
    const row = mapInsightRow(
      { ...FULL_ROW, actions: [{ action_type: 'lead', value: '12' }] },
      CTX,
    );
    expect(row.landingPageViews).toBe(0);
  });

  it('devolve null nos nomes ausentes em vez de string vazia', () => {
    const row = mapInsightRow({ date_start: '2026-08-10', ad_id: '123', account_currency: 'BRL' }, CTX);
    expect(row.adName).toBeNull();
    expect(row.adsetId).toBeNull();
    expect(row.campaignName).toBeNull();
  });

  it('rejeita linha sem ad_id', () => {
    expect(() => mapInsightRow({ date_start: '2026-08-10', account_currency: 'BRL' }, CTX)).toThrow(
      /ad_id/,
    );
  });

  it('rejeita linha sem date_start', () => {
    expect(() => mapInsightRow({ ad_id: '123', account_currency: 'BRL' }, CTX)).toThrow(/date_start/);
  });

  it('cai para BRL quando a Meta nao informa a moeda', () => {
    const row = mapInsightRow({ date_start: '2026-08-10', ad_id: '123' }, CTX);
    expect(row.currency).toBe('BRL');
  });
});
