export interface InsightMapContext {
  organizationId: string;
  connectionId: string;
  syncedAt: Date;
}

export interface AdDailyStatRow {
  organizationId: string;
  connectionId: string;
  date: Date;
  adId: string;
  adName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  currency: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  landingPageViews: number;
  frequency: number;
  ctr: number;
  cpc: number;
  /** Array cru de `actions` da Graph, ou null. Convertido para Json no processor. */
  actions: unknown[] | null;
  syncedAt: Date;
}

/** A Graph manda tudo como string; ausência vira 0, nunca NaN. */
function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** `landing_page_view` não é campo do insights — vem dentro de `actions`. */
function actionValue(actions: unknown, type: string): number {
  if (!Array.isArray(actions)) return 0;
  const found = actions.find((a) => a?.action_type === type);
  return found ? num(found.value) : 0;
}

export function mapInsightRow(raw: any, ctx: InsightMapContext): AdDailyStatRow {
  if (!raw?.ad_id) {
    throw new Error('linha de insights sem ad_id — resposta inesperada da Graph API');
  }
  if (!raw?.date_start) {
    throw new Error('linha de insights sem date_start — time_increment=1 nao foi aplicado?');
  }

  return {
    organizationId: ctx.organizationId,
    connectionId: ctx.connectionId,
    date: new Date(`${raw.date_start}T00:00:00.000Z`),
    adId: String(raw.ad_id),
    adName: str(raw.ad_name),
    adsetId: str(raw.adset_id),
    adsetName: str(raw.adset_name),
    campaignId: str(raw.campaign_id),
    campaignName: str(raw.campaign_name),
    currency: str(raw.account_currency) ?? 'BRL',
    spend: num(raw.spend),
    impressions: num(raw.impressions),
    reach: num(raw.reach),
    clicks: num(raw.clicks),
    linkClicks: num(raw.inline_link_clicks),
    landingPageViews: actionValue(raw.actions, 'landing_page_view'),
    frequency: num(raw.frequency),
    ctr: num(raw.ctr),
    cpc: num(raw.cpc),
    actions: Array.isArray(raw.actions) ? raw.actions : null,
    syncedAt: ctx.syncedAt,
  };
}
