import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { byTemplate, bySender, perConversation, type PerConversation, type SenderRow, type TemplateRow } from './breakdown.aggregate';
import { buildDaily, buildTotals, unitPrices, type CostDay, type CostTotals } from './costs.aggregate';
import { resolvePeriod, type CostPeriod } from './costs.period';
import { MetaPricingClient } from './meta-pricing.client';
import { WhatsappCostsRepository, type CostChannel } from './whatsapp-costs.repository';

export interface ChannelCosts {
  channelId: string;
  channelName: string;
  currency: string;
  status: 'ok' | 'error';
  error: string | null;
  totals: CostTotals;
  daily: CostDay[];
}

export interface CostsReport {
  from: string;
  to: string;
  tz: string;
  channels: ChannelCosts[];
  totalsByCurrency: Array<{ currency: string; cost: number }>;
}

export interface CostsBreakdown {
  channelId: string;
  currency: string;
  unitPrices: Record<string, number>;
  senders: SenderRow[];
  templates: TemplateRow[];
  perConversation: PerConversation | null;
}

/** A Meta atualiza o custo algumas vezes por hora; 10 min poupa chamadas do bot e da tela. */
const CACHE_TTL_MS = 10 * 60_000;
/** Canal sem acesso (conta antiga, token vencido) não muda em minutos: evita chamar a Meta e logar a cada tique. */
const ERROR_CACHE_TTL_MS = 60 * 60_000;
const CACHE_MAX_ENTRIES = 200;
const EMPTY_TOTALS: CostTotals = { cost: 0, billable: 0, free: 0, byCategory: [] };

export function sumByCurrency(channels: ReadonlyArray<ChannelCosts>): Array<{ currency: string; cost: number }> {
  const acc = new Map<string, number>();
  for (const ch of channels.filter((c) => c.status === 'ok')) acc.set(ch.currency, (acc.get(ch.currency) ?? 0) + ch.totals.cost);
  return [...acc.entries()].map(([currency, cost]) => ({ currency, cost: Number(cost.toFixed(2)) }));
}

/**
 * Custo do WhatsApp oficial: o total vem da Meta (é a fatura); a divisão por
 * vendedor e template é estimada a partir dos status gravados nos webhooks.
 */
@Injectable()
export class WhatsappCostsService {
  private readonly logger = new Logger(WhatsappCostsService.name);
  private readonly cache = new Map<string, { at: number; value: ChannelCosts }>();

  constructor(
    private readonly repository: WhatsappCostsRepository,
    private readonly meta: MetaPricingClient,
  ) {}

  async getCosts(organizationId: string, now: Date, from?: string, to?: string): Promise<CostsReport> {
    const tz = await this.repository.orgTimezone(organizationId);
    const period = resolvePeriod(tz, now, from, to);
    const channels = await this.repository.listChannels(organizationId);
    const results = await Promise.all(channels.map((ch) => this.channelCosts(ch, period, tz, now)));
    const used = results.filter((r) => r.status === 'error' || r.totals.billable + r.totals.free > 0);
    return { from: period.from, to: period.to, tz, channels: used, totalsByCurrency: sumByCurrency(used) };
  }

  async getBreakdown(organizationId: string, channelId: string, now: Date, from?: string, to?: string): Promise<CostsBreakdown> {
    const tz = await this.repository.orgTimezone(organizationId);
    const period = resolvePeriod(tz, now, from, to);
    const channel = (await this.repository.listChannels(organizationId)).find((c) => c.id === channelId);
    if (!channel) throw new NotFoundException('Canal não encontrado');
    const [costs, rows] = await Promise.all([
      this.channelCosts(channel, period, tz, now),
      this.repository.billedMessages(channel.id, period.start, period.end),
    ]);
    const prices = unitPrices(costs.totals.byCategory);
    return {
      channelId,
      currency: costs.currency,
      unitPrices: prices,
      senders: bySender(rows, prices),
      templates: byTemplate(rows, prices),
      perConversation: perConversation(rows),
    };
  }

  private async channelCosts(channel: CostChannel, period: CostPeriod, tz: string, now: Date): Promise<ChannelCosts> {
    const key = `${channel.id}|${period.from}|${period.to}`;
    const hit = this.cache.get(key);
    const ttl = hit?.value.status === 'error' ? ERROR_CACHE_TTL_MS : CACHE_TTL_MS;
    if (hit && now.getTime() - hit.at < ttl) return hit.value;
    const value = await this.fetchChannel(channel, period, tz);
    this.remember(key, now, value);
    return value;
  }

  private async fetchChannel(channel: CostChannel, period: CostPeriod, tz: string): Promise<ChannelCosts> {
    const base = { channelId: channel.id, channelName: channel.name };
    if (!channel.wabaId || !channel.token) {
      return { ...base, currency: '', status: 'error', error: 'Canal sem conta da Meta configurada', totals: EMPTY_TOTALS, daily: [] };
    }
    try {
      const { currency, points } = await this.meta.fetchDaily(channel.wabaId, channel.token, period.start, period.end);
      return {
        ...base,
        currency,
        status: 'ok',
        error: null,
        totals: buildTotals(points),
        daily: buildDaily(points, tz, period.from, period.to),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`custos_meta_falhou canal=${channel.id}: ${message}`);
      return { ...base, currency: '', status: 'error', error: message, totals: EMPTY_TOTALS, daily: [] };
    }
  }

  private remember(key: string, now: Date, value: ChannelCosts): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, { at: now.getTime(), value });
  }
}
