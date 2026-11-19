import { localParts } from '../routing/availability/business-hours.util';
import {
  firstName,
  formatAgentBreakdown,
  UNASSIGNED_LABEL,
} from '../response-sla/manager-alerts/manager-alerts.format';
import { formatClock, formatDate, formatDuration, minutesSince } from '../manager-bot/manager-bot.format';
import type { PresenceStatus } from '../team-presence/presence.util';

/**
 * Textos curtos de cada linha do pulso (puro). Cada função devolve UMA
 * variável do template; o `team-pulse.params` sanitiza e corta.
 */

export const SEPARATOR = ' · ';
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;
const MINUTES_PER_HOUR = 60;
/** Até 5 min depois da hora cheia o título ainda diz "15h". */
const ON_THE_HOUR_TOLERANCE = 5;

export interface PulseMember {
  name: string;
  status: PresenceStatus;
  lastActiveAt: string | null;
  today: { firstSeenAt: string | null };
}

export interface ClockDay {
  firstSeenAt: string;
  /** Último uso real; nulo em dias antigos (aí vale lastSeenAt). */
  lastActiveAt: string | null;
  lastSeenAt: string;
  activeMinutes: number;
}

export interface LeadCounts {
  total: number;
  /** Abertas, sem atendente, com a Aline no comando. */
  withAi?: number;
  /** Abertas, sem atendente, com transferência pendente ("Na fila"). */
  inQueue?: number;
}

/** "qui 19/11". */
export function formatDayLabel(now: Date, tz: string): string {
  return `${WEEKDAYS[localParts(now, tz).dow]} ${formatDate(now, tz)}`;
}

/** "15h · qui 19/11"; fora da hora cheia (teste manual), "15:37 · qui 19/11". */
export function formatPulseTitle(now: Date, tz: string): string {
  const { minutes } = localParts(now, tz);
  const onTheHour = minutes % MINUTES_PER_HOUR < ON_THE_HOUR_TOLERANCE;
  const time = onTheHour ? `${Math.floor(minutes / MINUTES_PER_HOUR)}h` : formatClock(now, tz);
  return `${time}${SEPARATOR}${formatDayLabel(now, tz)}`;
}

/** "3 online · 1 ausente · 1 offline" (zeros omitidos). */
export function formatTeamCounts(members: ReadonlyArray<Pick<PulseMember, 'status'>>): string {
  if (members.length === 0) return 'ninguém no horário';
  const count = (status: PresenceStatus) => members.filter((m) => m.status === status).length;
  return [
    [count('online'), 'online'],
    [count('away'), 'ausente'],
    [count('offline'), 'offline'],
  ]
    .filter(([n]) => Number(n) > 0)
    .map(([n, label]) => `${n} ${label}`)
    .join(SEPARATOR);
}

/** "Pedro (desde 09:02) · Marcella (desde 14:05)" ou "ninguém". */
export function formatOnline(members: ReadonlyArray<PulseMember>, tz: string): string {
  const online = members.filter((m) => m.status === 'online');
  if (online.length === 0) return 'ninguém';
  return online
    .map((m) => {
      const since = m.today.firstSeenAt ? ` (desde ${formatClock(new Date(m.today.firstSeenAt), tz)})` : '';
      return `${firstName(m.name)}${since}`;
    })
    .join(SEPARATOR);
}

/** "Gabriela ausente há 22 min · Rafael offline" ou "nenhum". */
export function formatAttention(members: ReadonlyArray<PulseMember>, now: Date): string {
  const lines = members.flatMap((m) => {
    if (m.status === 'offline') return [`${firstName(m.name)} offline`];
    if (m.status !== 'away') return [];
    const idle = m.lastActiveAt ? ` há ${formatDuration(minutesSince(m.lastActiveAt, now))}` : '';
    return [`${firstName(m.name)} ausente${idle}`];
  });
  return lines.length ? lines.join(SEPARATOR) : 'nenhum';
}

function countWithBreakdown(rows: ReadonlyArray<{ agentName: string | null }>, empty: string): string {
  if (rows.length === 0) return empty;
  return `${rows.length} (${formatAgentBreakdown(rows, SEPARATOR)})`;
}

/** "12 (Pedro 5 · Marcella 4 · sem dono 3)" ou "nenhuma". */
export function formatWaiting(waits: ReadonlyArray<{ agentName: string | null }>): string {
  return countWithBreakdown(waits, 'nenhuma');
}

/** "48 min (Pedro)" — tempo de relógio da espera aberta mais antiga. */
export function formatOldestWait(
  waits: ReadonlyArray<{ agentName: string | null; waitingSince: Date }>,
  now: Date,
): string {
  if (waits.length === 0) return 'nenhuma';
  const oldest = waits.reduce((min, w) => (w.waitingSince < min.waitingSince ? w : min));
  const owner = oldest.agentName ? firstName(oldest.agentName) : UNASSIGNED_LABEL;
  return `${formatDuration(minutesSince(oldest.waitingSince, now))} (${owner})`;
}

/** "2 (Pedro 1 · sem dono 1)" ou "nenhum". */
export function formatBreaches(breaches: ReadonlyArray<{ agentName: string | null }>): string {
  return countWithBreakdown(breaches, 'nenhum');
}

/** "7 (4 com a Aline · 3 na fila)"; o resto (já com atendente) vira "com vendedor". */
export function formatLeads(leads: LeadCounts): string {
  if (leads.total === 0) return 'nenhum';
  if (leads.withAi === undefined || leads.inQueue === undefined) return String(leads.total);
  const withSeller = Math.max(0, leads.total - leads.withAi - leads.inQueue);
  const parts = [
    [leads.withAi, 'com a Aline'],
    [leads.inQueue, 'na fila'],
    [withSeller, 'com vendedor'],
  ]
    .filter(([n]) => Number(n) > 0)
    .map(([n, label]) => `${n} ${label}`);
  return parts.length ? `${leads.total} (${parts.join(SEPARATOR)})` : String(leads.total);
}

/** "Pedro 09:02–18:11 (ativo 7h05) · …" pela ordem de entrada; saída = último uso. */
export function formatDayClock(
  days: ReadonlyArray<{ name: string; day: ClockDay | null }>,
  tz: string,
): string {
  const worked = days
    .filter((d): d is { name: string; day: ClockDay } => d.day !== null)
    .sort((a, b) => a.day.firstSeenAt.localeCompare(b.day.firstSeenAt));
  if (worked.length === 0) return 'ninguém entrou hoje';
  return worked
    .map(({ name, day }) => {
      const entry = formatClock(new Date(day.firstSeenAt), tz);
      const exit = formatClock(new Date(day.lastActiveAt ?? day.lastSeenAt), tz);
      return `${firstName(name)} ${entry}–${exit} (ativo ${formatDuration(day.activeMinutes)})`;
    })
    .join(SEPARATOR);
}
