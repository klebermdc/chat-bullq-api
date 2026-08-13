import { Injectable } from '@nestjs/common';
import { AdConnectionStatus, CardStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

export interface MediaAggregate {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  landingPageViews: number;
  currencies: string[];
}

export interface DailySpendRow {
  date: string;
  spend: number;
}

export interface DailyLeadsRow {
  date: string;
  leads: number;
}

export interface CrmTotals {
  leads: number;
  wonDeals: number;
  wonRevenue: number;
}

export interface BrokenConnection {
  status: AdConnectionStatus;
  accountName: string | null;
  lastSyncError: string | null;
}

export interface ConnectionState {
  hasConnection: boolean;
  lastSyncAt: Date | null;
  /** Preenchido quando alguma conexão da org não está ACTIVE. */
  brokenConnection: BrokenConnection | null;
}

/**
 * Camada fina sobre o Prisma. Não agrega `frequency`/`ctr` aqui — são razões,
 * não somas, e média-las por dia pesaria um dia de 10 impressões igual a um
 * dia de 100 mil. Quem deriva CTR/frequência é o serviço, a partir dos
 * campos aditivos devolvidos por `aggregateMedia`.
 */
@Injectable()
export class MarketingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Agregado de mídia no período. Nunca devolve null: zeros quando não há linha. */
  async aggregateMedia(organizationId: string, from: Date, to: Date): Promise<MediaAggregate> {
    const where: Prisma.AdDailyStatWhereInput = {
      organizationId,
      date: { gte: from, lte: to },
    };

    const [agg, distinctCurrencies] = await Promise.all([
      this.prisma.adDailyStat.aggregate({
        where,
        _sum: {
          spend: true,
          impressions: true,
          reach: true,
          clicks: true,
          linkClicks: true,
          landingPageViews: true,
        },
      }),
      this.prisma.adDailyStat.findMany({
        where,
        select: { currency: true },
        distinct: ['currency'],
      }),
    ]);

    return {
      spend: Number(agg._sum.spend ?? 0),
      impressions: agg._sum.impressions ?? 0,
      reach: agg._sum.reach ?? 0,
      clicks: agg._sum.clicks ?? 0,
      linkClicks: agg._sum.linkClicks ?? 0,
      landingPageViews: agg._sum.landingPageViews ?? 0,
      currencies: distinctCurrencies.map((c) => c.currency),
    };
  }

  /** Série diária de gasto, para o gráfico. */
  async dailySpend(organizationId: string, from: Date, to: Date): Promise<DailySpendRow[]> {
    const grouped = await this.prisma.adDailyStat.groupBy({
      by: ['date'],
      where: { organizationId, date: { gte: from, lte: to } },
      _sum: { spend: true },
      orderBy: { date: 'asc' },
    });

    return grouped.map((row) => ({
      date: this.toDateKey(row.date),
      spend: Number(row._sum.spend ?? 0),
    }));
  }

  /** Série diária de leads (Contact.createdAt), para o gráfico. */
  async dailyLeads(organizationId: string, from: Date, to: Date): Promise<DailyLeadsRow[]> {
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; leads: bigint }>>(
      Prisma.sql`
        SELECT date_trunc('day', "created_at")::date AS day, COUNT(*)::bigint AS leads
        FROM "contacts"
        WHERE "organization_id" = ${organizationId}
          AND "deleted_at" IS NULL
          AND "created_at" >= ${from}
          AND "created_at" <= ${to}
        GROUP BY day
        ORDER BY day ASC
      `,
    );

    return rows.map((row) => ({
      date: this.toDateKey(row.day),
      leads: Number(row.leads),
    }));
  }

  /** Contadores do CRM no período. Mesmas definições do crm-reports. */
  async crmTotals(organizationId: string, from: Date, to: Date): Promise<CrmTotals> {
    const [leads, wonAgg] = await Promise.all([
      this.prisma.contact.count({
        where: { organizationId, deletedAt: null, createdAt: { gte: from, lte: to } },
      }),
      this.prisma.card.aggregate({
        where: {
          organizationId,
          status: CardStatus.WON,
          closedAt: { gte: from, lte: to },
        },
        _count: { _all: true },
        _sum: { value: true },
      }),
    ]);

    return {
      leads,
      wonDeals: wonAgg._count._all,
      wonRevenue: Number(wonAgg._sum.value ?? 0),
    };
  }

  /** Sync mais recente entre as conexões da org, e se existe alguma conexão. */
  /**
   * Além de "existe conexão?", devolve se ALGUMA está quebrada.
   *
   * Sem isso o painel mostra o histórico inteiro de uma conta cujo token
   * morreu, sem nenhum sinal de que parou de atualizar — os números ficam
   * plausíveis e velhos ao mesmo tempo, que é o pior estado possível. A saúde
   * da conexão só aparecia em Configurações, onde ninguém olha ao ler KPI.
   */
  async connectionState(organizationId: string): Promise<ConnectionState> {
    const [count, latest, broken] = await Promise.all([
      this.prisma.adAccountConnection.count({ where: { organizationId } }),
      this.prisma.adAccountConnection.findFirst({
        where: { organizationId, lastSyncAt: { not: null } },
        select: { lastSyncAt: true },
        orderBy: { lastSyncAt: 'desc' },
      }),
      this.prisma.adAccountConnection.findFirst({
        where: { organizationId, status: { not: AdConnectionStatus.ACTIVE } },
        select: { status: true, lastSyncError: true, accountName: true },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    return {
      hasConnection: count > 0,
      lastSyncAt: latest?.lastSyncAt ?? null,
      brokenConnection: broken
        ? {
            status: broken.status,
            accountName: broken.accountName,
            lastSyncError: broken.lastSyncError,
          }
        : null,
    };
  }

  private toDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
