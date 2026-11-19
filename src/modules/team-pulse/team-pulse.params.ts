import { sanitizeTemplateParamTo } from '../response-sla/manager-alerts/manager-alerts.format';
import {
  formatAttention,
  formatBreaches,
  formatDayClock,
  formatDayLabel,
  formatLeads,
  formatOldestWait,
  formatOnline,
  formatPulseTitle,
  formatTeamCounts,
  formatWaiting,
  type ClockDay,
  type LeadCounts,
  type PulseMember,
} from './team-pulse.format';

/**
 * Variáveis dos templates na ordem do corpo aprovado na Meta
 * (docs/templates/pulso-atendimento.md). Mudar a ordem aqui exige mudar o template.
 */

/** Teto por variável: mantém o corpo inteiro bem abaixo do limite da Meta. */
export const PULSE_PARAM_MAX = 200;
/** O ponto do dia lista a equipe toda; ganha mais espaço. */
export const CLOCK_PARAM_MAX = 400;

type Wait = { agentName: string | null; waitingSince: Date };
type Breach = { agentName: string | null };

export interface HourlyInput {
  now: Date;
  tz: string;
  /** Só quem está dentro do próprio horário agora. */
  members: ReadonlyArray<PulseMember>;
  waits: ReadonlyArray<Wait>;
  /** Estouros de SLA da última hora. */
  breaches: ReadonlyArray<Breach>;
  /** Conversas novas da última hora. */
  leads: LeadCounts;
}

export interface ClosingInput {
  now: Date;
  tz: string;
  days: ReadonlyArray<{ name: string; day: ClockDay | null }>;
  waits: ReadonlyArray<Wait>;
  breaches: ReadonlyArray<Breach>;
  leads: LeadCounts;
}

const clean = (value: string) => sanitizeTemplateParamTo(value, PULSE_PARAM_MAX);

/** {{1}} hora · {{2}} equipe · {{3}} online · {{4}} atenção · {{5}} esperando · {{6}} mais antiga · {{7}} SLA · {{8}} leads. */
export function buildHourlyParams(input: HourlyInput): string[] {
  return [
    formatPulseTitle(input.now, input.tz),
    formatTeamCounts(input.members),
    formatOnline(input.members, input.tz),
    formatAttention(input.members, input.now),
    formatWaiting(input.waits),
    formatOldestWait(input.waits, input.now),
    formatBreaches(input.breaches),
    formatLeads(input.leads),
  ].map(clean);
}

/** {{1}} dia · {{2}} ponto · {{3}} esperando · {{4}} SLA do dia · {{5}} leads do dia. */
export function buildClosingParams(input: ClosingInput): string[] {
  return [
    clean(formatDayLabel(input.now, input.tz)),
    sanitizeTemplateParamTo(formatDayClock(input.days, input.tz), CLOCK_PARAM_MAX),
    clean(formatWaiting(input.waits)),
    clean(formatBreaches(input.breaches)),
    clean(formatLeads({ total: input.leads.total })),
  ];
}
