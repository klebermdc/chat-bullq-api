import type { BusinessHoursConfig } from '../routing/availability/business-hours.util';
import type { SlaStage } from './response-sla.rules';

/** Fila de timers de SLA (já existia; o SLA por departamento era código morto). */
export const RESPONSE_SLA_QUEUE = 'sla-timers';
export const RESPONSE_SLA_STAGE_JOB = 'response-sla-stage';
export const RESPONSE_SLA_RECONCILE_JOB = 'response-sla-reconcile';
/** A cada 10 min fecha esperas cuja conversa saiu do Esperando por um caminho sem gancho. */
export const RESPONSE_SLA_RECONCILE_PATTERN = '*/10 * * * *';

export interface StageJobData {
  recordId: string;
  conversationId: string;
  /** ms desde epoch — a espera a que o job pertence. */
  waitingSince: number;
  stage: SlaStage;
}

/** Tudo o que o SLA precisa saber da conversa, já resolvido. */
export interface SlaContext {
  conversationId: string;
  organizationId: string;
  assignedToId: string | null;
  contactName: string;
  isWaiting: boolean;
  /** null = recurso desligado na org. */
  slaMinutes: number | null;
  tz: string;
  /** Agenda que vale para esta conversa; null = 24/7. */
  hours: BusinessHoursConfig | null;
}

export interface SlaRecord {
  id: string;
  organizationId: string;
  conversationId: string;
  agentId: string | null;
  slaMinutes: number;
  waitingSince: Date;
  dueAt: Date | null;
  warnedAt: Date | null;
  breached: boolean;
  respondedAt: Date | null;
  endedAt: Date | null;
}

export type EndReason =
  | 'closed'
  | 'archived'
  | 'manual_unmark'
  | 'handoff_rejected'
  | 'not_waiting'
  | 'sla_disabled'
  | 'reconcile';
