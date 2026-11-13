import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Custo real das mensagens pela Graph API (`pricing_analytics` da WABA): é o
 * mesmo número que vira fatura na Meta. Doc:
 * developers.facebook.com/docs/whatsapp/business-management-api/analytics#pricing-analytics
 */
export interface PricingPoint {
  /** Início do dia na conta da Meta (epoch em segundos). */
  start: number;
  end: number;
  category: string;
  type: string;
  volume: number;
  cost: number;
}

export interface PricingResult {
  currency: string;
  points: PricingPoint[];
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const DEFAULT_VERSION = 'v24.0';
const TIMEOUT_MS = 20_000;

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function parsePricingResponse(json: unknown): PricingResult {
  const body = (json ?? {}) as Record<string, any>;
  const blocks: any[] = Array.isArray(body.pricing_analytics?.data) ? body.pricing_analytics.data : [];
  const points = blocks.flatMap((b) => (Array.isArray(b?.data_points) ? b.data_points : []));
  return {
    currency: typeof body.currency === 'string' ? body.currency : 'USD',
    points: points.map((p) => ({
      start: toNumber(p?.start),
      end: toNumber(p?.end),
      category: String(p?.pricing_category ?? 'UNKNOWN').toUpperCase(),
      type: String(p?.pricing_type ?? 'UNKNOWN').toUpperCase(),
      volume: toNumber(p?.volume),
      cost: toNumber(p?.cost),
    })),
  };
}

export function pricingFields(from: Date, to: Date): string {
  const start = Math.floor(from.getTime() / 1000);
  const end = Math.floor(to.getTime() / 1000);
  return (
    `currency,pricing_analytics.start(${start}).end(${end}).granularity(DAILY)` +
    `.metric_types(["COST","VOLUME"]).dimensions(["PRICING_CATEGORY","PRICING_TYPE"])`
  );
}

@Injectable()
export class MetaPricingClient {
  private readonly version: string;
  private fetchImpl: FetchLike = fetch;

  constructor(config: ConfigService) {
    this.version = config.get<string>('WHATSAPP_PRICING_API_VERSION')?.trim() || DEFAULT_VERSION;
  }

  /** Para testes. */
  useFetch(fetchImpl: FetchLike): this {
    this.fetchImpl = fetchImpl;
    return this;
  }

  async fetchDaily(wabaId: string, token: string, from: Date, to: Date): Promise<PricingResult> {
    const url = new URL(`https://graph.facebook.com/${this.version}/${encodeURIComponent(wabaId)}`);
    url.searchParams.set('fields', pricingFields(from, to));
    const res = await this.fetchImpl(url.toString(), {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const meta = (json as any)?.error;
      throw new Error(`Meta ${res.status}: ${meta?.error_user_msg ?? meta?.message ?? 'erro'}`);
    }
    return parsePricingResponse(json);
  }
}
