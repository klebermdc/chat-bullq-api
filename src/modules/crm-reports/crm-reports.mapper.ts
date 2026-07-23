import { CardStatus, OrgRole } from '@prisma/client';
import { DealsQueryDto } from './dto/deals-query.dto';
import { LeadsQueryDto } from './dto/leads-query.dto';
import { ConversationsQueryDto } from './dto/conversations-query.dto';
import {
  DealsReportParams,
  DealRow,
  LeadsReportParams,
  LeadRow,
  ConversationsReportParams,
  ConversationRow,
} from './crm-reports.types';

const CONVERSATION_STATUSES = ['PENDING', 'BOT', 'OPEN', 'WAITING', 'CLOSED'];

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

export function parseLeadsParams(
  q: LeadsQueryDto,
  orgId: string,
  userId: string,
  role: OrgRole,
): LeadsReportParams {
  const temp = toNum(q.temperatureMin);
  return {
    orgId,
    userId,
    role,
    channelId: q.channelId || undefined,
    assignedToId: q.assignedToId || undefined,
    tagId: q.tagId || undefined,
    hasProposal:
      q.hasProposal === 'true' ? true : q.hasProposal === 'false' ? false : undefined,
    hasDeal: q.hasDeal === 'true' ? true : q.hasDeal === 'false' ? false : undefined,
    temperatureMin: temp && temp >= 1 && temp <= 3 ? temp : undefined,
    from: toDate(q.from),
    to: toDate(q.to),
    page: toNum(q.page) ?? 1,
    perPage: Math.min(toNum(q.perPage) ?? 25, 10000),
  };
}

export function parseConversationsParams(
  q: ConversationsQueryDto,
  orgId: string,
  userId: string,
  role: OrgRole,
): ConversationsReportParams {
  return {
    orgId,
    userId,
    role,
    status:
      q.status && CONVERSATION_STATUSES.includes(q.status) ? q.status : undefined,
    channelId: q.channelId || undefined,
    assignedToId: q.assignedToId || undefined,
    tagId: q.tagId || undefined,
    reopened:
      q.reopened === 'true' ? true : q.reopened === 'false' ? false : undefined,
    answered:
      q.answered === 'true' ? true : q.answered === 'false' ? false : undefined,
    from: toDate(q.from),
    to: toDate(q.to),
    page: toNum(q.page) ?? 1,
    perPage: Math.min(toNum(q.perPage) ?? 25, 10000),
  };
}

const fmtDuration = (s: number | null) => {
  if (s == null) return '';
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  return `${(s / 3600).toFixed(1)}h`;
};

export function conversationsRowsToCsv(rows: ConversationRow[]): string {
  const header = [
    'Contato',
    'Canal',
    'Status',
    'Atendente',
    '1a resposta',
    'Reaberturas',
    'Criado',
    'Fechado',
  ];
  const lines = rows.map((r) =>
    [
      r.contactName,
      r.channelName,
      r.status,
      r.assignedToName,
      fmtDuration(r.firstResponseSeconds),
      r.reopenedCount,
      r.createdAt,
      r.closedAt ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

export function leadsRowsToCsv(rows: LeadRow[]): string {
  const header = [
    'Nome',
    'Telefone',
    'Canal',
    'Atendente',
    'Tags',
    'Proposta',
    'Deal',
    'Temperatura',
    'Criado',
  ];
  const tempLabel = (t: number | null) =>
    t === 3 ? 'Quente' : t === 2 ? 'Morno' : t === 1 ? 'Frio' : '';
  const lines = rows.map((r) =>
    [
      r.name,
      r.phone,
      r.channelName,
      r.assignedToName,
      r.tags.join('; '),
      r.hasProposal ? 'Sim' : 'Não',
      r.hasDeal ? 'Sim' : 'Não',
      tempLabel(r.temperature),
      r.createdAt,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}
