import { Injectable } from '@nestjs/common';
import { Prisma, CardStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  DealsReportParams,
  DealsReportResult,
  DealRow,
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
}
