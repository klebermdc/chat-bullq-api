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
