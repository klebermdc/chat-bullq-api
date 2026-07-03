import { Injectable } from '@nestjs/common';
import { ConversationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface DateRange {
  from: Date;
  to: Date;
}

export interface ConvFilters {
  channelId?: string;
  departmentId?: string;
  status?: ConversationStatus;
  assignedToId?: string;
}

export interface LeadsFilter extends ConvFilters {
  from: Date;
  to: Date;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mescla filtros opcionais num `where` de Conversation, respeitando RN-05:
   * quando `scope` (userId do AGENT) está setado, ele sobrepõe qualquer
   * `assignedToId` vindo do filtro (fail-closed — o AGENT não escapa do escopo).
   */
  private applyConvFilters<T extends Record<string, unknown>>(
    base: T,
    filters: ConvFilters,
    scope?: string,
  ): T & Record<string, unknown> {
    const where: Record<string, unknown> = { ...base };
    if (filters.channelId) where.channelId = filters.channelId;
    if (filters.departmentId) where.departmentId = filters.departmentId;
    if (filters.status) where.status = filters.status;
    const assigned = scope ?? filters.assignedToId;
    if (assigned) where.assignedToId = assigned;
    return where as T & Record<string, unknown>;
  }

  /**
   * Versão relacional de `applyConvFilters` para queries de Message/Rating/Tag
   * que filtram via a relação `conversation: {...}`. Mesma barreira RN-05:
   * o `scope` sobrepõe qualquer `assignedToId` vindo do filtro.
   */
  private applyRelFilters(filters: ConvFilters, scope?: string): Record<string, unknown> {
    const rel: Record<string, unknown> = {};
    if (filters.channelId) rel.channelId = filters.channelId;
    if (filters.departmentId) rel.departmentId = filters.departmentId;
    if (filters.status) rel.status = filters.status;
    const assigned = scope ?? filters.assignedToId;
    if (assigned) rel.assignedToId = assigned;
    return rel;
  }

  async getOverview(
    organizationId: string,
    range: DateRange,
    assignedToId?: string,
    filters: ConvFilters = {},
  ) {
    const rel = this.applyRelFilters(filters, assignedToId);
    const where = this.applyConvFilters(
      { organizationId, createdAt: { gte: range.from, lte: range.to } },
      filters,
      assignedToId,
    );
    const prevFrom = new Date(range.from.getTime() - (range.to.getTime() - range.from.getTime()));
    const prevWhere = this.applyConvFilters(
      { organizationId, createdAt: { gte: prevFrom, lte: range.from } },
      filters,
      assignedToId,
    );

    const [
      totalConversations,
      prevTotal,
      openConversations,
      pendingConversations,
      waitingConversations,
      botConversations,
      stuckConversations,
      totalMessages,
      prevMessages,
      closedInPeriod,
      prevClosedInPeriod,
    ] = await this.prisma.$transaction([
      this.prisma.conversation.count({ where: where as Prisma.ConversationWhereInput }),
      this.prisma.conversation.count({ where: prevWhere as Prisma.ConversationWhereInput }),
      this.prisma.conversation.count({ where: this.applyConvFilters({ organizationId, status: 'OPEN' }, filters, assignedToId) as Prisma.ConversationWhereInput }),
      this.prisma.conversation.count({ where: this.applyConvFilters({ organizationId, status: 'PENDING' }, filters, assignedToId) as Prisma.ConversationWhereInput }),
      this.prisma.conversation.count({ where: this.applyConvFilters({ organizationId, status: 'WAITING' }, filters, assignedToId) as Prisma.ConversationWhereInput }),
      this.prisma.conversation.count({ where: this.applyConvFilters({ organizationId, status: 'BOT' }, filters, assignedToId) as Prisma.ConversationWhereInput }),
      this.prisma.conversation.count({
        where: this.applyConvFilters({ organizationId, isStuck: true, deletedAt: null }, filters, assignedToId) as Prisma.ConversationWhereInput,
      }),
      this.prisma.message.count({ where: { conversation: { organizationId, ...rel }, createdAt: { gte: range.from, lte: range.to } } }),
      this.prisma.message.count({ where: { conversation: { organizationId, ...rel }, createdAt: { gte: prevFrom, lte: range.from } } }),
      this.prisma.conversation.count({
        where: this.applyConvFilters({ organizationId, status: 'CLOSED', closedAt: { gte: range.from, lte: range.to } }, filters, assignedToId) as Prisma.ConversationWhereInput,
      }),
      this.prisma.conversation.count({
        where: this.applyConvFilters({ organizationId, status: 'CLOSED', closedAt: { gte: prevFrom, lte: range.from } }, filters, assignedToId) as Prisma.ConversationWhereInput,
      }),
    ]);

    const [avgFirstResponse, prevAvgFirstResponse] = await Promise.all([
      this.getAvgFirstResponseTime(organizationId, range, assignedToId, filters),
      this.getAvgFirstResponseTime(organizationId, { from: prevFrom, to: range.from }, assignedToId, filters),
    ]);
    const avgResolution = await this.getAvgResolutionTime(organizationId, range, assignedToId, filters);
    const [slaCompliance, prevSlaCompliance] = await Promise.all([
      this.getSlaCompliance(organizationId, range, assignedToId, filters),
      this.getSlaCompliance(organizationId, { from: prevFrom, to: range.from }, assignedToId, filters),
    ]);

    const [closedNoReopen, csatAgg, prevCsatAgg] = await Promise.all([
      this.prisma.conversation.count({
        where: this.applyConvFilters({
          organizationId, status: 'CLOSED',
          closedAt: { gte: range.from, lte: range.to },
          reopenedCount: 0,
        }, filters, assignedToId) as Prisma.ConversationWhereInput,
      }),
      this.prisma.conversationRating.aggregate({
        where: { organizationId, conversation: rel, respondedAt: { gte: range.from, lte: range.to } },
        _avg: { score: true },
        _count: { _all: true },
      }),
      this.prisma.conversationRating.aggregate({
        where: { organizationId, conversation: rel, respondedAt: { gte: prevFrom, lte: range.from } },
        _avg: { score: true },
      }),
    ]);

    const fcrPercent =
      closedInPeriod > 0 ? Math.round((closedNoReopen / closedInPeriod) * 100) : null;
    const csatScore = csatAgg._avg.score !== null ? Math.round(csatAgg._avg.score * 10) / 10 : null;
    const prevCsatScore = prevCsatAgg._avg.score;
    const csatTrend =
      csatScore !== null && prevCsatScore !== null
        ? Math.round((csatScore - prevCsatScore) * 10) / 10
        : 0;

    const activeConversations = openConversations + pendingConversations + waitingConversations;

    const resolutionRatePercent =
      totalConversations > 0 ? Math.round((closedInPeriod / totalConversations) * 100) : null;
    const prevResolutionRatePercent = prevTotal > 0 ? (prevClosedInPeriod / prevTotal) * 100 : null;

    return {
      activeConversations,
      activeBreakdown: {
        pending: pendingConversations,
        open: openConversations,
        waiting: waitingConversations,
        bot: botConversations,
      },
      stuckConversations,

      avgFirstResponseMinutes: avgFirstResponse,
      avgFirstResponseTrend:
        avgFirstResponse !== null && prevAvgFirstResponse !== null
          ? this.calcTrend(avgFirstResponse, prevAvgFirstResponse)
          : 0,

      slaCompliancePercent: slaCompliance,
      slaTrend:
        slaCompliance !== null && prevSlaCompliance !== null
          ? slaCompliance - prevSlaCompliance
          : 0,

      resolutionRatePercent,
      resolutionTrend:
        resolutionRatePercent !== null && prevResolutionRatePercent !== null
          ? Math.round(resolutionRatePercent - prevResolutionRatePercent)
          : 0,

      fcrPercent,
      csatScore,
      csatResponses: csatAgg._count._all,
      csatTrend,

      totalConversations,
      conversationsTrend: this.calcTrend(totalConversations, prevTotal),
      openConversations,
      pendingConversations,
      totalMessages,
      messagesTrend: this.calcTrend(totalMessages, prevMessages),
      avgResolutionMinutes: avgResolution,
    };
  }

  async getKpiSparklines(
    organizationId: string,
    range: DateRange,
    assignedToId?: string,
    filters: ConvFilters = {},
  ) {
    const dept = await this.prisma.department.findFirst({
      where: { organizationId, isDefault: true },
      select: { slaFirstResponse: true },
    });
    const slaMinutes = dept?.slaFirstResponse ?? null;

    const conversations = await this.prisma.conversation.findMany({
      where: this.applyConvFilters(
        { organizationId, createdAt: { gte: range.from, lte: range.to } },
        filters,
        assignedToId,
      ) as Prisma.ConversationWhereInput,
      select: { createdAt: true, firstResponseAt: true, closedAt: true, status: true },
    });

    const dayKeys = this.eachDay(range.from, range.to);
    const buckets = new Map<
      string,
      { created: number; closed: number; tmrSum: number; tmrCount: number; slaWithin: number; slaCount: number }
    >();
    for (const k of dayKeys) {
      buckets.set(k, { created: 0, closed: 0, tmrSum: 0, tmrCount: 0, slaWithin: 0, slaCount: 0 });
    }

    for (const c of conversations) {
      const k = c.createdAt.toISOString().slice(0, 10);
      const b = buckets.get(k);
      if (!b) continue;
      b.created++;
      if (c.firstResponseAt) {
        const minutes = (c.firstResponseAt.getTime() - c.createdAt.getTime()) / 60000;
        b.tmrSum += minutes;
        b.tmrCount++;
        if (slaMinutes !== null) {
          b.slaCount++;
          if (minutes <= slaMinutes) b.slaWithin++;
        }
      }
      if (c.status === 'CLOSED' && c.closedAt && c.closedAt >= range.from && c.closedAt <= range.to) {
        b.closed++;
      }
    }

    const active = dayKeys.map((d) => ({ date: d, value: buckets.get(d)!.created }));
    const firstResponse = dayKeys.map((d) => {
      const b = buckets.get(d)!;
      return { date: d, value: b.tmrCount > 0 ? Math.round(b.tmrSum / b.tmrCount) : 0 };
    });
    const sla = dayKeys.map((d) => {
      const b = buckets.get(d)!;
      return { date: d, value: b.slaCount > 0 ? Math.round((b.slaWithin / b.slaCount) * 100) : 0 };
    });
    const resolution = dayKeys.map((d) => {
      const b = buckets.get(d)!;
      return { date: d, value: b.created > 0 ? Math.round((b.closed / b.created) * 100) : 0 };
    });

    return { active, firstResponse, sla, resolution };
  }

  async getCsatBreakdown(
    organizationId: string,
    range: DateRange,
    assignedToId?: string,
    filters: ConvFilters = {},
  ) {
    const convFilter = this.applyRelFilters(filters, assignedToId);
    const [agg, ratings, recent] = await Promise.all([
      this.prisma.conversationRating.aggregate({
        where: { organizationId, conversation: convFilter, respondedAt: { gte: range.from, lte: range.to } },
        _avg: { score: true },
        _count: { _all: true },
      }),
      this.prisma.conversationRating.groupBy({
        by: ['score'],
        where: { organizationId, conversation: convFilter, respondedAt: { gte: range.from, lte: range.to } },
        _count: true,
      }),
      this.prisma.conversationRating.findMany({
        where: {
          organizationId,
          conversation: convFilter,
          respondedAt: { gte: range.from, lte: range.to },
          comment: { not: null },
        },
        orderBy: { respondedAt: 'desc' },
        take: 5,
        select: {
          id: true, score: true, comment: true, respondedAt: true,
          conversation: { select: { contact: { select: { name: true } } } },
        },
      }),
    ]);

    const totalRequested = await this.prisma.conversationRating.count({
      where: { organizationId, conversation: convFilter, requestedAt: { gte: range.from, lte: range.to } },
    });

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of ratings) distribution[r.score] = r._count;

    return {
      avgScore: agg._avg.score !== null ? Math.round(agg._avg.score * 10) / 10 : null,
      totalResponses: agg._count._all,
      totalRequested,
      responseRate: totalRequested > 0
        ? Math.round((agg._count._all / totalRequested) * 100)
        : null,
      distribution,
      recentComments: recent.map((r) => ({
        id: r.id,
        score: r.score,
        comment: r.comment,
        respondedAt: r.respondedAt,
        contactName: r.conversation.contact.name,
      })),
    };
  }

  async getReopens(
    organizationId: string,
    range: DateRange,
    assignedToId?: string,
    filters: ConvFilters = {},
  ) {
    const reopened = await this.prisma.conversation.findMany({
      where: this.applyConvFilters({
        organizationId,
        reopenedCount: { gt: 0 },
        reopenedAt: { gte: range.from, lte: range.to },
      }, filters, assignedToId) as Prisma.ConversationWhereInput,
      select: {
        id: true,
        reopenedAt: true,
        reopenedCount: true,
        assignedTo: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true } },
      },
    });

    const closedInPeriod = await this.prisma.conversation.count({
      where: this.applyConvFilters({ organizationId, status: 'CLOSED', closedAt: { gte: range.from, lte: range.to } }, filters, assignedToId) as Prisma.ConversationWhereInput,
    });

    const dayKeys = this.eachDay(range.from, range.to);
    const series = new Map<string, number>(dayKeys.map((d) => [d, 0]));
    for (const c of reopened) {
      if (!c.reopenedAt) continue;
      const k = c.reopenedAt.toISOString().slice(0, 10);
      if (series.has(k)) series.set(k, series.get(k)! + 1);
    }

    const totalReopens = reopened.reduce((s, r) => s + r.reopenedCount, 0);
    const reopenRate = closedInPeriod > 0
      ? Math.round((reopened.length / (closedInPeriod + reopened.length)) * 100)
      : null;

    return {
      totalReopens,
      uniqueConversationsReopened: reopened.length,
      reopenRate,
      series: dayKeys.map((d) => ({ date: d, value: series.get(d)! })),
      worstOffenders: reopened
        .sort((a, b) => b.reopenedCount - a.reopenedCount)
        .slice(0, 5)
        .map((c) => ({
          conversationId: c.id,
          contactName: c.contact.name,
          agentName: c.assignedTo?.name ?? null,
          reopenedCount: c.reopenedCount,
        })),
    };
  }

  async getLeadsReport(
    organizationId: string,
    filter: LeadsFilter,
    scope?: string,
  ) {
    const where = this.applyConvFilters(
      { organizationId, createdAt: { gte: filter.from, lte: filter.to } },
      filter,
      scope,
    );

    const conversations = await this.prisma.conversation.findMany({
      where: where as Prisma.ConversationWhereInput,
      select: {
        id: true,
        assignedToId: true,
        status: true,
        createdAt: true,
        firstResponseAt: true,
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    const convIds = conversations.map((c) => c.id);
    const messages = convIds.length
      ? await this.prisma.message.findMany({
          where: { conversationId: { in: convIds } },
          select: { conversationId: true, direction: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    const firstDir = new Map<string, 'INBOUND' | 'OUTBOUND'>();
    const hasInbound = new Set<string>();
    for (const m of messages) {
      if (!firstDir.has(m.conversationId)) firstDir.set(m.conversationId, m.direction);
      if (m.direction === 'INBOUND') hasInbound.add(m.conversationId);
    }

    let proactiveLeads = 0;
    let respondedLeads = 0;
    let receptiveLeads = 0;

    type Row = {
      seller: { id: string; name: string; avatarUrl: string | null } | null;
      received: number; responded: number; open: number; closed: number;
      frSum: number; frCount: number;
    };
    const rows = new Map<string, Row>();

    for (const c of conversations) {
      const firstDirection = firstDir.get(c.id);
      const isProactive = firstDirection === 'OUTBOUND';
      const isReceptive = firstDirection === 'INBOUND';
      const responded = isProactive && hasInbound.has(c.id);
      if (isProactive) proactiveLeads++;
      if (isReceptive) receptiveLeads++;
      if (responded) respondedLeads++;

      const key = c.assignedToId ?? '__none__';
      if (!rows.has(key)) {
        rows.set(key, {
          seller: c.assignedTo ?? null,
          received: 0, responded: 0, open: 0, closed: 0, frSum: 0, frCount: 0,
        });
      }
      const row = rows.get(key)!;
      row.received++;
      if (responded) row.responded++;
      if (c.status === 'CLOSED') row.closed++;
      else if (c.status === 'OPEN' || c.status === 'PENDING' || c.status === 'WAITING') row.open++;
      if (c.firstResponseAt) {
        row.frSum += (c.firstResponseAt.getTime() - c.createdAt.getTime()) / 60000;
        row.frCount++;
      }
    }

    const bySeller = Array.from(rows.values())
      .map((r) => ({
        seller: r.seller,
        received: r.received,
        responded: r.responded,
        open: r.open,
        closed: r.closed,
        avgFirstResponseMin: r.frCount ? Math.round(r.frSum / r.frCount) : null,
      }))
      .sort((a, b) => b.received - a.received);

    return {
      newLeads: conversations.length,
      proactiveLeads,
      receptiveLeads,
      respondedLeads,
      respondedRate: proactiveLeads > 0 ? Math.round((respondedLeads / proactiveLeads) * 100) : null,
      bySeller,
    };
  }

  private eachDay(from: Date, to: Date): string[] {
    const days: string[] = [];
    const cur = new Date(from);
    cur.setUTCHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setUTCHours(0, 0, 0, 0);
    while (cur <= end) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return days;
  }

  async getVolumeByDay(
    organizationId: string,
    range: DateRange,
    assignedToId?: string,
    filters: ConvFilters = {},
  ) {
    const conversations = await this.prisma.conversation.findMany({
      where: this.applyConvFilters(
        { organizationId, createdAt: { gte: range.from, lte: range.to } },
        filters,
        assignedToId,
      ) as Prisma.ConversationWhereInput,
      select: { createdAt: true },
    });

    const byDay = new Map<string, number>();
    for (const c of conversations) {
      const day = c.createdAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }

    return Array.from(byDay.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async getVolumeByChannel(
    organizationId: string,
    range: DateRange,
    assignedToId?: string,
    filters: ConvFilters = {},
  ) {
    const result = await this.prisma.conversation.groupBy({
      by: ['channelId'],
      where: this.applyConvFilters(
        { organizationId, createdAt: { gte: range.from, lte: range.to } },
        filters,
        assignedToId,
      ) as Prisma.ConversationWhereInput,
      _count: true,
    });

    const channels = await this.prisma.channel.findMany({
      where: { organizationId },
      select: { id: true, name: true, type: true },
    });

    return result.map((r) => {
      const ch = channels.find((c) => c.id === r.channelId);
      return { channelId: r.channelId, channelName: ch?.name || 'Unknown', channelType: ch?.type, count: r._count };
    });
  }

  async getVolumeByStatus(organizationId: string, assignedToId?: string, filters: ConvFilters = {}) {
    const result = await this.prisma.conversation.groupBy({
      by: ['status'],
      where: this.applyConvFilters({ organizationId }, filters, assignedToId) as Prisma.ConversationWhereInput,
      _count: true,
    });
    return result.map((r) => ({ status: r.status, count: r._count }));
  }

  async getAgentPerformance(
    organizationId: string,
    range: DateRange,
    assignedToId?: string,
    filters: ConvFilters = {},
  ) {
    // Barreira (RN-05): AGENT só vê a própria linha. `assignedToId: { not: null }`
    // já exclui não-atribuídas; quando escopado, força a igualdade ao userId.
    // Este método mantém sua própria lógica de `assignedToId` (não usa
    // applyConvFilters pra não sobrescrevê-la); dos filtros só aproveitamos
    // channelId/departmentId. `status` é ignorado aqui: o groupBy de carga
    // atual já filtra por status abertos e a listagem principal precisa de
    // todos os status pra calcular resolutionRate.
    const assignedFilter: Prisma.StringNullableFilter | string = assignedToId
      ? assignedToId
      : { not: null };
    const extra: Prisma.ConversationWhereInput = {};
    if (filters.channelId) extra.channelId = filters.channelId;
    if (filters.departmentId) extra.departmentId = filters.departmentId;
    const [conversations, currentLoadGroups] = await Promise.all([
      this.prisma.conversation.findMany({
        where: {
          organizationId,
          assignedToId: assignedFilter,
          createdAt: { gte: range.from, lte: range.to },
          ...extra,
        },
        select: {
          assignedToId: true,
          status: true,
          firstResponseAt: true,
          closedAt: true,
          createdAt: true,
          assignedTo: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
      this.prisma.conversation.groupBy({
        by: ['assignedToId'],
        where: {
          organizationId,
          assignedToId: assignedFilter,
          status: { in: ['OPEN', 'PENDING', 'WAITING'] },
          ...extra,
        },
        _count: true,
      }),
    ]);

    const currentLoad = new Map<string, number>();
    for (const g of currentLoadGroups) {
      if (g.assignedToId) currentLoad.set(g.assignedToId, g._count);
    }

    const agentMap = new Map<string, {
      agent: { id: string; name: string; avatarUrl: string | null };
      total: number;
      closed: number;
      responseTimes: number[];
      resolutionTimes: number[];
    }>();

    for (const c of conversations) {
      if (!c.assignedToId || !c.assignedTo) continue;
      if (!agentMap.has(c.assignedToId)) {
        agentMap.set(c.assignedToId, {
          agent: c.assignedTo, total: 0, closed: 0, responseTimes: [], resolutionTimes: [],
        });
      }
      const a = agentMap.get(c.assignedToId)!;
      a.total++;
      if (c.status === 'CLOSED') {
        a.closed++;
        if (c.closedAt) {
          a.resolutionTimes.push((c.closedAt.getTime() - c.createdAt.getTime()) / 60000);
        }
      }
      if (c.firstResponseAt) {
        a.responseTimes.push((c.firstResponseAt.getTime() - c.createdAt.getTime()) / 60000);
      }
    }

    return Array.from(agentMap.values()).map((a) => ({
      agent: a.agent,
      totalConversations: a.total,
      closedConversations: a.closed,
      activeConversations: currentLoad.get(a.agent.id) ?? 0,
      resolutionRate: a.total > 0 ? Math.round((a.closed / a.total) * 100) : 0,
      avgFirstResponseMinutes: a.responseTimes.length
        ? Math.round(a.responseTimes.reduce((s, v) => s + v, 0) / a.responseTimes.length)
        : null,
      avgResolutionMinutes: a.resolutionTimes.length
        ? Math.round(a.resolutionTimes.reduce((s, v) => s + v, 0) / a.resolutionTimes.length)
        : null,
    }));
  }

  async getVolumeFlow(
    organizationId: string,
    range: DateRange,
    assignedToId?: string,
    filters: ConvFilters = {},
  ) {
    const conversations = await this.prisma.conversation.findMany({
      where: this.applyConvFilters({
        organizationId,
        OR: [
          { createdAt: { gte: range.from, lte: range.to } },
          { closedAt: { gte: range.from, lte: range.to } },
        ],
      }, filters, assignedToId) as Prisma.ConversationWhereInput,
      select: { createdAt: true, closedAt: true },
    });

    const dayKeys = this.eachDay(range.from, range.to);
    const buckets = new Map<string, { created: number; closed: number }>();
    for (const k of dayKeys) buckets.set(k, { created: 0, closed: 0 });

    for (const c of conversations) {
      const ck = c.createdAt.toISOString().slice(0, 10);
      if (buckets.has(ck)) buckets.get(ck)!.created++;
      if (c.closedAt) {
        const dk = c.closedAt.toISOString().slice(0, 10);
        if (buckets.has(dk)) buckets.get(dk)!.closed++;
      }
    }

    return dayKeys.map((d) => ({ date: d, ...buckets.get(d)! }));
  }

  async getPeakHours(
    organizationId: string,
    range: DateRange,
    assignedToId?: string,
    filters: ConvFilters = {},
  ) {
    const conversations = await this.prisma.conversation.findMany({
      where: this.applyConvFilters(
        { organizationId, createdAt: { gte: range.from, lte: range.to } },
        filters,
        assignedToId,
      ) as Prisma.ConversationWhereInput,
      select: { createdAt: true },
    });

    const matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let max = 0;
    for (const c of conversations) {
      const dow = c.createdAt.getUTCDay();
      const hour = c.createdAt.getUTCHours();
      matrix[dow][hour]++;
      if (matrix[dow][hour] > max) max = matrix[dow][hour];
    }
    return { matrix, max };
  }

  async getMessagesFlow(
    organizationId: string,
    range: DateRange,
    assignedToId?: string,
    filters: ConvFilters = {},
  ) {
    const messages = await this.prisma.message.findMany({
      where: {
        conversation: { organizationId, ...this.applyRelFilters(filters, assignedToId) },
        createdAt: { gte: range.from, lte: range.to },
      },
      select: { createdAt: true, direction: true },
    });

    const dayKeys = this.eachDay(range.from, range.to);
    const buckets = new Map<string, { inbound: number; outbound: number }>();
    for (const k of dayKeys) buckets.set(k, { inbound: 0, outbound: 0 });

    for (const m of messages) {
      const k = m.createdAt.toISOString().slice(0, 10);
      const b = buckets.get(k);
      if (!b) continue;
      if (m.direction === 'INBOUND') b.inbound++;
      else b.outbound++;
    }

    return dayKeys.map((d) => ({ date: d, ...buckets.get(d)! }));
  }

  async getBotPerformance(
    organizationId: string,
    range: DateRange,
    assignedToId?: string,
    filters: ConvFilters = {},
  ) {
    // Nota: pra um AGENT escopado, "botResolved" (conversas sem assignedTo)
    // será sempre 0 por construção — o AGENT só enxerga as próprias conversas
    // atribuídas. É o comportamento correto sob RN-05: ele não pode ver
    // métricas de bot que abrangem conversas de terceiros. OWNER/ADMIN veem
    // o quadro completo da org.
    const conversations = await this.prisma.conversation.findMany({
      where: this.applyConvFilters(
        { organizationId, createdAt: { gte: range.from, lte: range.to } },
        filters,
        assignedToId,
      ) as Prisma.ConversationWhereInput,
      select: { status: true, assignedToId: true, closedAt: true },
    });

    let botResolved = 0;
    let humanHandled = 0;
    let inFlight = 0;

    for (const c of conversations) {
      if (c.assignedToId) {
        humanHandled++;
      } else if (c.status === 'CLOSED' && c.closedAt) {
        botResolved++;
      } else {
        inFlight++;
      }
    }

    const total = conversations.length;
    const totalCompleted = botResolved + humanHandled;

    return {
      botResolved,
      humanHandled,
      inFlight,
      total,
      botResolutionRate: totalCompleted > 0 ? Math.round((botResolved / totalCompleted) * 100) : null,
      escalationRate: totalCompleted > 0 ? Math.round((humanHandled / totalCompleted) * 100) : null,
    };
  }

  async getTopTags(
    organizationId: string,
    range: DateRange,
    assignedToId?: string,
    filters: ConvFilters = {},
    limit = 5,
  ) {
    const tagged = await this.prisma.conversationTag.findMany({
      where: {
        conversation: {
          organizationId,
          ...this.applyRelFilters(filters, assignedToId),
          createdAt: { gte: range.from, lte: range.to },
        },
      },
      select: { tag: { select: { id: true, name: true, color: true } } },
    });

    const counts = new Map<string, { id: string; name: string; color: string; count: number }>();
    for (const t of tagged) {
      const k = t.tag.id;
      if (!counts.has(k)) counts.set(k, { id: t.tag.id, name: t.tag.name, color: t.tag.color, count: 0 });
      counts.get(k)!.count++;
    }

    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  private async getAvgFirstResponseTime(organizationId: string, range: DateRange, assignedToId?: string, filters: ConvFilters = {}): Promise<number | null> {
    const convs = await this.prisma.conversation.findMany({
      where: this.applyConvFilters({
        organizationId,
        firstResponseAt: { not: null },
        createdAt: { gte: range.from, lte: range.to },
      }, filters, assignedToId) as Prisma.ConversationWhereInput,
      select: { createdAt: true, firstResponseAt: true },
    });
    if (convs.length === 0) return null;
    const total = convs.reduce((s, c) => s + (c.firstResponseAt!.getTime() - c.createdAt.getTime()), 0);
    return Math.round(total / convs.length / 60000);
  }

  private async getAvgResolutionTime(organizationId: string, range: DateRange, assignedToId?: string, filters: ConvFilters = {}): Promise<number | null> {
    const convs = await this.prisma.conversation.findMany({
      where: this.applyConvFilters({
        organizationId,
        closedAt: { not: null },
        createdAt: { gte: range.from, lte: range.to },
      }, filters, assignedToId) as Prisma.ConversationWhereInput,
      select: { createdAt: true, closedAt: true },
    });
    if (convs.length === 0) return null;
    const total = convs.reduce((s, c) => s + (c.closedAt!.getTime() - c.createdAt.getTime()), 0);
    return Math.round(total / convs.length / 60000);
  }

  private async getSlaCompliance(organizationId: string, range: DateRange, assignedToId?: string, filters: ConvFilters = {}): Promise<number | null> {
    const dept = await this.prisma.department.findFirst({
      where: { organizationId, isDefault: true },
      select: { slaFirstResponse: true },
    });
    if (!dept?.slaFirstResponse) return null;

    const slaMinutes = dept.slaFirstResponse;
    const convs = await this.prisma.conversation.findMany({
      where: this.applyConvFilters({
        organizationId,
        firstResponseAt: { not: null },
        createdAt: { gte: range.from, lte: range.to },
      }, filters, assignedToId) as Prisma.ConversationWhereInput,
      select: { createdAt: true, firstResponseAt: true },
    });
    if (convs.length === 0) return null;

    const withinSla = convs.filter(
      (c) => (c.firstResponseAt!.getTime() - c.createdAt.getTime()) / 60000 <= slaMinutes,
    ).length;

    return Math.round((withinSla / convs.length) * 100);
  }

  private calcTrend(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  }
}
