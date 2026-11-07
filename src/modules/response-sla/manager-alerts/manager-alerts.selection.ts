import type { BusinessHoursConfig } from '../../routing/availability/business-hours.util';
import { businessMinutesBetween } from '../../routing/availability/business-minutes.util';
import { countWithin } from '../../dashboard/response-sla-metrics';
import {
  firstName,
  formatAgentBreakdown,
  formatAgentScores,
  formatOldest,
  formatOverall,
  sanitizeTemplateParam,
  type WithinCount,
} from './manager-alerts.format';

/** Seleção e montagem das variáveis dos templates (puro). */

export interface OpenWait {
  contactName: string;
  agentName: string | null;
  waitingSince: Date;
  /** Agenda do dono (ou da org, se sem dono/sem horário); null = 24/7. */
  hours: BusinessHoursConfig | null;
}

export interface OverdueWait {
  contactName: string;
  agentName: string | null;
  businessMinutes: number;
}

/** Esperas abertas com pelo menos `thresholdMinutes` minutos ÚTEIS, mais antiga primeiro. */
export function selectOverdueWaits(
  waits: ReadonlyArray<OpenWait>,
  tz: string,
  now: Date,
  thresholdMinutes: number,
): OverdueWait[] {
  return waits
    .map((w) => ({
      contactName: w.contactName,
      agentName: w.agentName,
      businessMinutes: businessMinutesBetween(w.hours, tz, w.waitingSince, now),
    }))
    .filter((w) => w.businessMinutes >= thresholdMinutes)
    .sort((a, b) => b.businessMinutes - a.businessMinutes);
}

/** {{1}} nome, {{2}} quantidade, {{3}} por atendente, {{4}} mais antigo. */
export function buildDigestParams(
  recipientName: string,
  overdue: ReadonlyArray<OverdueWait>,
): string[] {
  return [
    firstName(recipientName),
    String(overdue.length),
    formatAgentBreakdown(overdue),
    formatOldest(overdue),
  ].map(sanitizeTemplateParam);
}

export interface ScoreRow {
  agentId: string | null;
  agentName: string | null;
  respondedAt: Date | null;
  breached: boolean;
}

export interface ScoreboardSummary {
  overall: WithinCount;
  agents: Array<{ agentName: string; percent: number }>;
}

/**
 * Placar do dia com a regra do dashboard (`countWithin`). `rows` já vem só
 * com as esperas que contam. Sem esperas → null (placar não sai).
 * Esperas sem dono entram no geral, mas não na lista por atendente.
 */
export function summarizeScoreboard(rows: ReadonlyArray<ScoreRow>): ScoreboardSummary | null {
  if (rows.length === 0) return null;
  const byAgent = rows.reduce((acc, r) => {
    if (!r.agentId) return acc;
    const current = acc.get(r.agentId);
    const entry = { name: current?.name ?? r.agentName ?? '-', rows: [...(current?.rows ?? []), r] };
    return new Map(acc).set(r.agentId, entry);
  }, new Map<string, { name: string; rows: ScoreRow[] }>());

  const agents = [...byAgent.values()]
    .map(({ name, rows: agentRows }) => {
      const { within, total } = countWithin(agentRows);
      return { agentName: name, percent: Math.round((within / total) * 100) };
    })
    .sort((a, b) => b.percent - a.percent || a.agentName.localeCompare(b.agentName, 'pt-BR'));

  return { overall: countWithin(rows), agents };
}

/** {{1}} nome, {{2}} geral, {{3}} por atendente. */
export function buildScoreboardParams(
  recipientName: string,
  summary: ScoreboardSummary | null,
): string[] {
  return [
    firstName(recipientName),
    formatOverall(summary?.overall ?? null),
    formatAgentScores(summary?.agents ?? []),
  ].map(sanitizeTemplateParam);
}
