import { Injectable } from '@nestjs/common';
import { Prisma, CardStatus, ConversationStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  DealsReportParams,
  DealsReportResult,
  DealRow,
  LeadsReportParams,
  LeadsReportResult,
  LeadRow,
  ConversationsReportParams,
  ConversationsReportResult,
  ConversationRow,
} from './crm-reports.types';

@Injectable()
export class CrmReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // Monta o WHERE dos deals a partir dos filtros + RBAC.
  buildDealsWhere(p: DealsReportParams): Prisma.CardWhereInput {
    const where: Prisma.CardWhereInput = { organizationId: p.orgId };
    if (p.pipelineId) where.pipelineId = p.pipelineId;
    if (p.stageIds?.length) where.stageId = { in: p.stageIds };
    if (p.status) where.status = p.status;
    if (p.assignedToId) where.assignedToId = p.assignedToId;
    if (p.valueMin != null || p.valueMax != null) {
      const v: Prisma.DecimalFilter = {};
      if (p.valueMin != null) v.gte = p.valueMin;
      if (p.valueMax != null) v.lte = p.valueMax;
      where.value = v;
    }
    if (p.hasProposal === true)
      where.contact = { is: { proposals: { some: {} } } };
    if (p.hasProposal === false)
      where.contact = { is: { proposals: { none: {} } } };
    const dateField = p.dateField === 'closedAt' ? 'closedAt' : 'createdAt';
    if (p.from || p.to) {
      const d: Prisma.DateTimeFilter = {};
      if (p.from) d.gte = p.from;
      if (p.to) d.lte = p.to;
      where[dateField] = d;
    }
    // RBAC: AGENT só vê deals dele (card OU conversa atribuída a ele).
    if (p.role === 'AGENT') {
      where.OR = [
        { assignedToId: p.userId },
        { conversation: { is: { assignedToId: p.userId } } },
      ];
    }
    return where;
  }

  async getDealsReport(p: DealsReportParams): Promise<DealsReportResult> {
    const where = this.buildDealsWhere(p);
    const page = p.page ?? 1;
    const perPage = p.perPage ?? 25;

    const [grouped, total, cards] = await Promise.all([
      this.prisma.card.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _sum: { value: true },
      }),
      this.prisma.card.count({ where }),
      this.prisma.card.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          contact: { select: { name: true, phone: true } },
          assignedTo: { select: { name: true } },
          conversation: { select: { assignedTo: { select: { name: true } } } },
          stage: { select: { name: true } },
          pipeline: { select: { name: true } },
        },
      }),
    ]);

    const byStatus = (s: CardStatus) => grouped.find((g) => g.status === s);
    const num = (v: unknown) => (v == null ? 0 : Number(v));
    const won = {
      count: byStatus(CardStatus.WON)?._count._all ?? 0,
      value: num(byStatus(CardStatus.WON)?._sum.value),
    };
    const lost = {
      count: byStatus(CardStatus.LOST)?._count._all ?? 0,
      value: num(byStatus(CardStatus.LOST)?._sum.value),
    };
    const totalValue = grouped.reduce((acc, g) => acc + num(g._sum.value), 0);
    const closed = won.count + lost.count;

    const rows: DealRow[] = cards.map((c) => ({
      id: c.id,
      contactName: c.contact?.name ?? c.contact?.phone ?? null,
      pipelineName: c.pipeline?.name ?? '',
      stageName: c.stage?.name ?? '',
      status: c.status,
      value: c.value == null ? null : Number(c.value),
      assignedToName: c.conversation?.assignedTo?.name ?? c.assignedTo?.name ?? null,
      createdAt: c.createdAt.toISOString(),
      closedAt: c.closedAt ? c.closedAt.toISOString() : null,
      closedReason: c.closedReason ?? null,
    }));

    return {
      metrics: {
        count: total,
        totalValue,
        won,
        lost,
        conversionRate: closed > 0 ? won.count / closed : 0,
        avgWonTicket: won.count > 0 ? won.value / won.count : 0,
      },
      rows,
      page,
      perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  // ─── Leads/Contatos ───────────────────────────────

  buildLeadsWhere(p: LeadsReportParams): Prisma.ContactWhereInput {
    const where: Prisma.ContactWhereInput = {
      organizationId: p.orgId,
      deletedAt: null,
    };
    if (p.from || p.to) {
      const d: Prisma.DateTimeFilter = {};
      if (p.from) d.gte = p.from;
      if (p.to) d.lte = p.to;
      where.createdAt = d;
    }
    if (p.tagId) where.tags = { some: { tagId: p.tagId } };
    if (p.hasProposal === true) where.proposals = { some: {} };
    if (p.hasProposal === false) where.proposals = { none: {} };
    if (p.hasDeal === true) where.cards = { some: {} };
    if (p.hasDeal === false) where.cards = { none: {} };

    // Filtros que dependem de uma conversa (canal / temperatura / atendente)
    // + RBAC: AGENT só vê leads com conversa atribuída a ele.
    const conv: Prisma.ConversationWhereInput = {};
    if (p.channelId) conv.channelId = p.channelId;
    if (p.temperatureMin != null) conv.temperature = { gte: p.temperatureMin };
    if (p.role === 'AGENT') conv.assignedToId = p.userId;
    else if (p.assignedToId) conv.assignedToId = p.assignedToId;
    if (Object.keys(conv).length > 0) where.conversations = { some: conv };

    return where;
  }

  async getLeadsReport(p: LeadsReportParams): Promise<LeadsReportResult> {
    const where = this.buildLeadsWhere(p);
    const page = p.page ?? 1;
    const perPage = p.perPage ?? 25;

    const [total, withProposal, withDeal, tagGroups, contacts] =
      await Promise.all([
        this.prisma.contact.count({ where }),
        this.prisma.contact.count({
          where: { ...where, proposals: { some: {} } },
        }),
        this.prisma.contact.count({ where: { ...where, cards: { some: {} } } }),
        this.prisma.contactTag.groupBy({
          by: ['tagId'],
          where: { contact: { is: where } },
          _count: { _all: true },
          orderBy: { _count: { tagId: 'desc' } },
          take: 5,
        }),
        this.prisma.contact.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * perPage,
          take: perPage,
          include: {
            tags: { select: { tag: { select: { name: true } } } },
            _count: { select: { proposals: true, cards: true } },
            conversations: {
              select: {
                assignedTo: { select: { name: true } },
                channel: { select: { name: true } },
                temperature: true,
              },
              orderBy: { lastMessageAt: 'desc' },
              take: 1,
            },
          },
        }),
      ]);

    const tagIds = tagGroups.map((g) => g.tagId);
    const tags = tagIds.length
      ? await this.prisma.tag.findMany({
          where: { id: { in: tagIds } },
          select: { id: true, name: true },
        })
      : [];
    const tagName = (id: string) => tags.find((t) => t.id === id)?.name ?? id;
    const byTag = tagGroups.map((g) => ({
      name: tagName(g.tagId),
      count: g._count._all,
    }));

    const rows: LeadRow[] = contacts.map((c) => {
      const conv = c.conversations[0];
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        channelName: conv?.channel?.name ?? null,
        assignedToName: conv?.assignedTo?.name ?? null,
        tags: c.tags.map((t) => t.tag.name),
        hasProposal: c._count.proposals > 0,
        hasDeal: c._count.cards > 0,
        temperature: conv?.temperature ?? null,
        createdAt: c.createdAt.toISOString(),
      };
    });

    const pct = (n: number) => (total > 0 ? n / total : 0);
    return {
      metrics: {
        count: total,
        withProposal: { count: withProposal, pct: pct(withProposal) },
        withDeal: { count: withDeal, pct: pct(withDeal) },
        byTag,
      },
      rows,
      page,
      perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  // ─── Conversas/Atendimento ─────────────────────────

  buildConversationsWhere(
    p: ConversationsReportParams,
  ): Prisma.ConversationWhereInput {
    const where: Prisma.ConversationWhereInput = {
      organizationId: p.orgId,
      deletedAt: null,
    };
    if (p.status) where.status = p.status as ConversationStatus;
    if (p.channelId) where.channelId = p.channelId;
    if (p.tagId) where.tags = { some: { tagId: p.tagId } };
    if (p.reopened === true) where.reopenedCount = { gt: 0 };
    if (p.reopened === false) where.reopenedCount = 0;
    if (p.answered === true) where.firstResponseAt = { not: null };
    if (p.answered === false) where.firstResponseAt = null;
    if (p.from || p.to) {
      const d: Prisma.DateTimeFilter = {};
      if (p.from) d.gte = p.from;
      if (p.to) d.lte = p.to;
      where.createdAt = d;
    }
    // RBAC: AGENT só vê conversas atribuídas a ele.
    if (p.role === 'AGENT') where.assignedToId = p.userId;
    else if (p.assignedToId) where.assignedToId = p.assignedToId;
    return where;
  }

  private firstResponseSeconds(
    createdAt: Date,
    firstResponseAt: Date | null,
  ): number | null {
    if (!firstResponseAt) return null;
    return Math.max(
      0,
      (firstResponseAt.getTime() - createdAt.getTime()) / 1000,
    );
  }

  async getConversationsReport(
    p: ConversationsReportParams,
  ): Promise<ConversationsReportResult> {
    const where = this.buildConversationsWhere(p);
    const page = p.page ?? 1;
    const perPage = p.perPage ?? 25;

    const [total, statusGroups, channelGroups, reopened, answeredCount, frSample, convs] =
      await Promise.all([
        this.prisma.conversation.count({ where }),
        this.prisma.conversation.groupBy({
          by: ['status'],
          where,
          _count: { _all: true },
        }),
        this.prisma.conversation.groupBy({
          by: ['channelId'],
          where,
          _count: { _all: true },
          orderBy: { _count: { channelId: 'desc' } },
          take: 5,
        }),
        this.prisma.conversation.count({
          where: { ...where, reopenedCount: { gt: 0 } },
        }),
        this.prisma.conversation.count({
          where: { ...where, firstResponseAt: { not: null } },
        }),
        this.prisma.conversation.findMany({
          where: { ...where, firstResponseAt: { not: null } },
          select: { createdAt: true, firstResponseAt: true },
          take: 5000,
        }),
        this.prisma.conversation.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * perPage,
          take: perPage,
          include: {
            contact: { select: { name: true, phone: true } },
            channel: { select: { name: true } },
            assignedTo: { select: { name: true } },
          },
        }),
      ]);

    const closed =
      statusGroups.find((g) => g.status === ConversationStatus.CLOSED)?._count
        ._all ?? 0;
    const open = total - closed;

    const channelIds = channelGroups.map((g) => g.channelId);
    const channels = channelIds.length
      ? await this.prisma.channel.findMany({
          where: { id: { in: channelIds } },
          select: { id: true, name: true },
        })
      : [];
    const channelName = (id: string) =>
      channels.find((c) => c.id === id)?.name ?? id;
    const byChannel = channelGroups.map((g) => ({
      name: channelName(g.channelId),
      count: g._count._all,
    }));

    const sampleSeconds = frSample
      .map((c) => this.firstResponseSeconds(c.createdAt, c.firstResponseAt))
      .filter((s): s is number => s != null);
    const avgFirstResponseSeconds =
      sampleSeconds.length > 0
        ? sampleSeconds.reduce((a, b) => a + b, 0) / sampleSeconds.length
        : null;

    const rows: ConversationRow[] = convs.map((c) => ({
      id: c.id,
      contactName: c.contact?.name ?? c.contact?.phone ?? null,
      channelName: c.channel?.name ?? null,
      status: c.status,
      assignedToName: c.assignedTo?.name ?? null,
      firstResponseSeconds: this.firstResponseSeconds(
        c.createdAt,
        c.firstResponseAt,
      ),
      reopenedCount: c.reopenedCount,
      createdAt: c.createdAt.toISOString(),
      closedAt: c.closedAt ? c.closedAt.toISOString() : null,
    }));

    return {
      metrics: {
        count: total,
        open,
        closed,
        reopened,
        avgFirstResponseSeconds,
        answeredCount,
        byChannel,
      },
      rows,
      page,
      perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    };
  }
}
