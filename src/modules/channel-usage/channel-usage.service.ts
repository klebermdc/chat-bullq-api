import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StatusUpdate } from '../channel-hub/ports/types';
import { aggregateWindows, UsageAggregate } from './channel-usage.aggregator';
import { ChannelType } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ChannelUsageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra (upsert) a janela de 24h a partir do status da Meta.
   * Idempotente pela chave única (channelId, metaConversationId).
   * No update, só grava category/billable/pricingModel quando o payload de
   * entrada os traz de fato — o `origin`/`pricing` costuma vir só no 1º status.
   * Assim um status posterior sem esses dados NÃO regride uma categoria boa
   * para "unknown" nem re-seta o billable no default.
   */
  async recordWindow(
    organizationId: string,
    channelId: string,
    status: StatusUpdate,
  ): Promise<void> {
    const conv = status.conversation;
    if (!conv?.id) return;

    const category = status.pricing?.category || conv.originType || 'unknown';
    const billable = status.pricing?.billable ?? true;
    const pricingModel = status.pricing?.pricingModel ?? null;
    const expirationAt = conv.expirationTimestamp
      ? new Date(conv.expirationTimestamp * 1000)
      : null;
    const openedAt = expirationAt
      ? new Date(expirationAt.getTime() - DAY_MS)
      : status.timestamp;

    const update: Record<string, any> = {};
    if (category !== 'unknown') update.category = category;
    if (status.pricing?.billable != null) update.billable = billable;
    if (pricingModel != null) update.pricingModel = pricingModel;
    if (expirationAt) update.expirationAt = expirationAt;

    await this.prisma.whatsappWindow.upsert({
      where: {
        uq_window_channel_conv: { channelId, metaConversationId: conv.id },
      },
      create: {
        organizationId,
        channelId,
        metaConversationId: conv.id,
        category,
        billable,
        pricingModel,
        openedAt,
        expirationAt,
      },
      update,
    });
  }

  private async loadRates(organizationId: string) {
    const row = await this.prisma.whatsappWindowPricing.findUnique({
      where: { organizationId },
    });
    return {
      rates: (row?.rates as Record<string, number>) ?? {},
      currency: row?.currency ?? 'BRL',
    };
  }

  /** Resumo por canal oficial no range [from, to). Default = mês corrente. */
  async summary(
    organizationId: string,
    from: Date,
    to: Date,
  ): Promise<
    Array<{ channelId: string; channelName: string } & UsageAggregate>
  > {
    const { rates, currency } = await this.loadRates(organizationId);

    const channels = await this.prisma.channel.findMany({
      where: {
        organizationId,
        type: ChannelType.WHATSAPP_OFFICIAL,
        deletedAt: null,
      },
      select: { id: true, name: true },
    });

    const results: Array<
      { channelId: string; channelName: string } & UsageAggregate
    > = [];
    for (const ch of channels) {
      const rows = await this.prisma.whatsappWindow.findMany({
        where: {
          organizationId,
          channelId: ch.id,
          openedAt: { gte: from, lt: to },
        },
        select: { category: true, billable: true },
      });
      results.push({
        channelId: ch.id,
        channelName: ch.name,
        ...aggregateWindows(rows, rates, currency),
      });
    }
    return results;
  }

  /** Série temporal (day|month) pro mini-relatório de um canal. */
  async timeseries(
    organizationId: string,
    channelId: string,
    from: Date,
    to: Date,
    bucket: 'day' | 'month',
  ) {
    const { rates, currency } = await this.loadRates(organizationId);
    const rows = await this.prisma.whatsappWindow.findMany({
      where: {
        organizationId,
        channelId,
        openedAt: { gte: from, lt: to },
      },
      select: { category: true, billable: true, openedAt: true },
      orderBy: { openedAt: 'asc' },
    });

    const groups = new Map<string, { category: string; billable: boolean }[]>();
    for (const r of rows) {
      const d = r.openedAt;
      const key =
        bucket === 'month'
          ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
          : d.toISOString().slice(0, 10);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ category: r.category, billable: r.billable });
    }

    return [...groups.entries()].map(([key, bucketRows]) => ({
      bucket: key,
      ...aggregateWindows(bucketRows, rates, currency),
    }));
  }

  async getPricing(organizationId: string) {
    return this.loadRates(organizationId);
  }

  async setPricing(
    organizationId: string,
    currency: string,
    rates: Record<string, number>,
  ) {
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(rates ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) clean[k] = v;
    }
    await this.prisma.whatsappWindowPricing.upsert({
      where: { organizationId },
      create: { organizationId, currency, rates: clean },
      update: { currency, rates: clean },
    });
    return { currency, rates: clean };
  }
}
