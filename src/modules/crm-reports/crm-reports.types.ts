import { CardStatus } from '@prisma/client';

export interface DealsReportParams {
  orgId: string;
  role: string; // OrgRole
  userId: string;
  pipelineId?: string;
  stageIds?: string[];
  status?: CardStatus;
  assignedToId?: string;
  valueMin?: number;
  valueMax?: number;
  hasProposal?: boolean;
  from?: Date;
  to?: Date;
  dateField?: 'createdAt' | 'closedAt';
  page?: number;
  perPage?: number;
}

export interface DealRow {
  id: string;
  contactName: string | null;
  pipelineName: string;
  stageName: string;
  status: CardStatus;
  value: number | null;
  assignedToName: string | null;
  createdAt: string;
  closedAt: string | null;
  closedReason: string | null;
}

export interface DealsMetrics {
  count: number;
  totalValue: number;
  won: { count: number; value: number };
  lost: { count: number; value: number };
  conversionRate: number; // 0..1
  avgWonTicket: number;
}

export interface DealsReportResult {
  metrics: DealsMetrics;
  rows: DealRow[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface LeadsReportParams {
  orgId: string;
  role: string; // OrgRole
  userId: string;
  channelId?: string;
  assignedToId?: string;
  tagId?: string;
  hasProposal?: boolean;
  hasDeal?: boolean;
  temperatureMin?: number; // 1..3
  from?: Date;
  to?: Date;
  page?: number;
  perPage?: number;
}

export interface LeadRow {
  id: string;
  name: string | null;
  phone: string | null;
  channelName: string | null;
  assignedToName: string | null;
  tags: string[];
  hasProposal: boolean;
  hasDeal: boolean;
  temperature: number | null;
  createdAt: string;
}

export interface LeadsMetrics {
  count: number;
  withProposal: { count: number; pct: number };
  withDeal: { count: number; pct: number };
  byTag: Array<{ name: string; count: number }>;
}

export interface LeadsReportResult {
  metrics: LeadsMetrics;
  rows: LeadRow[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface ConversationsReportParams {
  orgId: string;
  role: string; // OrgRole
  userId: string;
  status?: string; // ConversationStatus
  channelId?: string;
  assignedToId?: string;
  tagId?: string;
  reopened?: boolean; // reopenedCount > 0
  answered?: boolean; // firstResponseAt != null
  from?: Date;
  to?: Date;
  page?: number;
  perPage?: number;
}

export interface ConversationRow {
  id: string;
  contactName: string | null;
  channelName: string | null;
  status: string;
  assignedToName: string | null;
  firstResponseSeconds: number | null;
  reopenedCount: number;
  createdAt: string;
  closedAt: string | null;
}

export interface ConversationsMetrics {
  count: number;
  open: number;
  closed: number;
  reopened: number; // conversas com reopenedCount > 0
  avgFirstResponseSeconds: number | null; // média (amostra) das que têm 1ª resposta
  answeredCount: number;
  byChannel: Array<{ name: string; count: number }>;
}

export interface ConversationsReportResult {
  metrics: ConversationsMetrics;
  rows: ConversationRow[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}
