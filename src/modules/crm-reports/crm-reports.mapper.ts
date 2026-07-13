import { CardStatus, OrgRole } from '@prisma/client';
import { DealsQueryDto } from './dto/deals-query.dto';
import { DealsReportParams, DealRow } from './crm-reports.types';

const toNum = (v?: string) =>
  v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined;
const toDate = (v?: string) => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

export function parseDealsParams(
  q: DealsQueryDto,
  orgId: string,
  userId: string,
  role: OrgRole,
): DealsReportParams {
  const status =
    q.status && ['OPEN', 'WON', 'LOST'].includes(q.status)
      ? (q.status as CardStatus)
      : undefined;
  return {
    orgId,
    userId,
    role,
    pipelineId: q.pipelineId || undefined,
    stageIds: q.stageIds ? q.stageIds.split(',').filter(Boolean) : undefined,
    status,
    assignedToId: q.assignedToId || undefined,
    valueMin: toNum(q.valueMin),
    valueMax: toNum(q.valueMax),
    hasProposal:
      q.hasProposal === 'true' ? true : q.hasProposal === 'false' ? false : undefined,
    from: toDate(q.from),
    to: toDate(q.to),
    dateField: q.dateField === 'closedAt' ? 'closedAt' : 'createdAt',
    page: toNum(q.page) ?? 1,
    perPage: Math.min(toNum(q.perPage) ?? 25, 10000),
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function dealsRowsToCsv(rows: DealRow[]): string {
  const header = [
    'Cliente',
    'Pipeline',
    'Etapa',
    'Status',
    'Valor',
    'Atendente',
    'Criado',
    'Fechado',
    'Motivo',
  ];
  const lines = rows.map((r) =>
    [
      r.contactName,
      r.pipelineName,
      r.stageName,
      r.status,
      r.value ?? '',
      r.assignedToName,
      r.createdAt,
      r.closedAt ?? '',
      r.closedReason ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}
