import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StatusUpdate } from '../channel-hub/ports/types';
import { aggregateWindows, UsageAggregate } from './channel-usage.aggregator';
import { ChannelType, Prisma } from '@prisma/client';
import {
  buildBillingUpsertArgs,
  toBillingRow,
} from './message-billing.mapper';
import {
  aggregateBilling,
  BillingBucketRow,
  BillingResponse,
} from './message-billing.aggregator';
import {
  aggregateDelivery,
  DeliveryBucketRow,
  DeliveryResponse,
} from './delivery.aggregator';
import { FailureCount } from './failure-reason.util';
import { listZonedDayKeys } from './zoned-day.util';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Teto de textos distintos de falha lidos por consulta (o relatório mostra 8). */
const MAX_FAILURE_REASON_GROUPS = 500;

/**
 * As colunas são `timestamp` (sem fuso) guardando UTC. O limite vai como texto
 * ISO convertido para UTC no próprio SQL, pra comparação não depender do
 * TimeZone da sessão do Postgres.
 */
function utcTimestamp(date: Date): Prisma.Sql {
  return Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

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

  /**
   * Registra (upsert) UMA linha por mensagem (wamid) com o `pricing` que a
   * Meta manda no status. Idempotente pela chave única (channelId, wamid).
   * Regras do update em `buildBillingUpsertArgs`: só sobrescreve o que o
   * payload traz de fato e nunca volta `billable: true` para false.
   */
  async recordMessageBilling(
    organizationId: string,
    channelId: string,
    status: StatusUpdate,
  ): Promise<void> {
    const row = toBillingRow(status);
    if (!row) return;
    await this.prisma.whatsappMessageBilling.upsert(
      buildBillingUpsertArgs(organizationId, channelId, row),
    );
  }

  /**
   * Custo por mensagem no range [from, to): o que a Meta marcou como cobrável
   * × tarifa da categoria. O banco devolve contagens por hora cheia; o
   * agrupamento por dia de São Paulo e o custo ficam em `aggregateBilling`.
   */
  async billing(
    organizationId: string,
    from: Date,
    to: Date,
  ): Promise<BillingResponse> {
    const [{ rates, currency }, rows, firstBillableService] = await Promise.all([
      this.loadRates(organizationId),
      this.prisma.$queryRaw<BillingBucketRow[]>(Prisma.sql`
        SELECT date_trunc('hour', status_at) AS "bucketAt",
               category,
               pricing_type AS "pricingType",
               billable,
               COUNT(*)::int AS count
        FROM whatsapp_message_billing
        WHERE organization_id = ${organizationId}
          AND status_at >= ${utcTimestamp(from)}
          AND status_at < ${utcTimestamp(to)}
        GROUP BY 1, 2, 3, 4
      `),
      this.prisma.whatsappMessageBilling.findFirst({
        where: { organizationId, category: 'service', billable: true },
        orderBy: { statusAt: 'asc' },
        select: { statusAt: true },
      }),
    ]);

    return aggregateBilling({
      rows,
      rates,
      currency,
      dayKeys: listZonedDayKeys(from, to),
      firstBillableServiceAt: firstBillableService?.statusAt ?? null,
    });
  }

  /**
   * Entrega das mensagens de SAÍDA dos canais oficiais da org no range
   * [from, to), pela data de criação da mensagem. `messages` não tem
   * organization_id: o escopo vem da conversa E do canal (os dois filtrados
   * pela org). Mensagens SYSTEM (notas internas do painel) ficam de fora —
   * nunca vão para o WhatsApp.
   */
  async delivery(
    organizationId: string,
    from: Date,
    to: Date,
  ): Promise<DeliveryResponse> {
    const scope = Prisma.sql`
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN channels ch ON ch.id = c.channel_id
      WHERE c.organization_id = ${organizationId}
        AND ch.organization_id = ${organizationId}
        AND ch.type = 'WHATSAPP_OFFICIAL'
        AND m.direction = 'OUTBOUND'
        AND m.type <> 'SYSTEM'
        AND m.created_at >= ${utcTimestamp(from)}
        AND m.created_at < ${utcTimestamp(to)}
    `;

    const [rows, failures] = await Promise.all([
      this.prisma.$queryRaw<DeliveryBucketRow[]>(Prisma.sql`
        SELECT date_trunc('hour', m.created_at) AS "bucketAt",
               m.status::text AS status,
               (m.type = 'TEMPLATE') AS "isTemplate",
               COUNT(*)::int AS count
        ${scope}
        GROUP BY 1, 2, 3
      `),
      this.prisma.$queryRaw<FailureCount[]>(Prisma.sql`
        SELECT m.failed_reason AS reason, COUNT(*)::int AS count
        ${scope}
          AND m.status = 'FAILED'
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT ${MAX_FAILURE_REASON_GROUPS}
      `),
    ]);

    return aggregateDelivery({
      rows,
      dayKeys: listZonedDayKeys(from, to),
      failures,
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
