import { localParts } from '../routing/availability/business-hours.util';
import { localDayStart } from '../response-sla/manager-alerts/manager-alerts.rules';

/** Regras puras de horário do gerente no Telegram. */

/** Tique perdido (deploy, Redis fora) ainda manda o relatório até 1h depois. */
export const REPORT_CATCHUP_MINUTES = 60;
const MONDAY = 1;
const DAYS_PER_WEEK = 7;
const DAY_MS = 24 * 60 * 60_000;

export interface Range {
  from: Date;
  to: Date;
}

export function isReportDue(now: Date, tz: string, reportMinutes: number): boolean {
  const { minutes } = localParts(now, tz);
  return minutes >= reportMinutes && minutes < reportMinutes + REPORT_CATCHUP_MINUTES;
}

export function isMonday(now: Date, tz: string): boolean {
  return localParts(now, tz).dow === MONDAY;
}

/**
 * Semana fechada mais recente (segunda a segunda local) e a anterior a ela.
 * Mesma aproximação de `localDayStart`: correta sem horário de verão.
 */
export function previousWeeks(now: Date, tz: string): { last: Range; before: Range } {
  const daysSinceMonday = (localParts(now, tz).dow + DAYS_PER_WEEK - MONDAY) % DAYS_PER_WEEK;
  const thisMonday = localDayStart(now, tz).getTime() - daysSinceMonday * DAY_MS;
  const lastMonday = thisMonday - DAYS_PER_WEEK * DAY_MS;
  const mondayBefore = lastMonday - DAYS_PER_WEEK * DAY_MS;
  return {
    last: { from: new Date(lastMonday), to: new Date(thisMonday) },
    before: { from: new Date(mondayBefore), to: new Date(lastMonday) },
  };
}
