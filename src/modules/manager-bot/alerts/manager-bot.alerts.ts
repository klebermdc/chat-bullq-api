import type { OverdueWait } from '../../response-sla/manager-alerts/manager-alerts.selection';
import { escapeHtml, formatDuration, minutesSince } from '../manager-bot.format';
import { MAX_LIST_LINES } from '../reports/opening.report';

/** Regras e textos dos alertas do dia (puros). */

export interface PresenceLine {
  userId: string;
  name: string;
  status: 'online' | 'away' | 'offline';
  lastActiveAt: string | null;
  schedule: { configured: boolean; withinHours: boolean | null };
}

export function formatSlaAlert(overdue: ReadonlyArray<OverdueWait>, afterMinutes: number): string | null {
  if (overdue.length === 0) return null;
  const lines = overdue
    .slice(0, MAX_LIST_LINES)
    .map(
      (w) =>
        `• ${escapeHtml(w.contactName)} — ${escapeHtml(w.agentName ?? 'sem dono')} — ${formatDuration(w.businessMinutes)} úteis`,
    );
  const rest = overdue.length - lines.length;
  return [
    `⏰ <b>${overdue.length} cliente(s) esperando há mais de ${afterMinutes} min</b>`,
    ...lines,
    ...(rest > 0 ? [`… e mais ${rest}`] : []),
  ].join('\n');
}

export function formatQueueAlert(
  unassigned: number,
  oldestSince: string | null,
  threshold: number,
  now: Date,
): string | null {
  if (unassigned <= threshold) return null;
  const oldest = oldestSince ? `, a mais antiga há ${formatDuration(minutesSince(oldestSince, now))}` : '';
  return `📥 <b>Fila sem dono com ${unassigned} conversas</b>${oldest}. Vale distribuir.`;
}

/** Offline (não só ausente) dentro do próprio expediente há pelo menos `offlineMinutes`. */
export function selectOfflineAgents(
  rows: ReadonlyArray<PresenceLine>,
  now: Date,
  offlineMinutes: number,
): PresenceLine[] {
  return rows.filter(
    (r) =>
      r.status === 'offline' &&
      r.schedule.configured &&
      r.schedule.withinHours === true &&
      (r.lastActiveAt === null || minutesSince(r.lastActiveAt, now) >= offlineMinutes),
  );
}

export function formatOfflineAlert(agents: ReadonlyArray<PresenceLine>, now: Date): string | null {
  if (agents.length === 0) return null;
  const lines = agents.map((a) => {
    const since = a.lastActiveAt ? `visto há ${formatDuration(minutesSince(a.lastActiveAt, now))}` : 'não entrou hoje';
    return `• ${escapeHtml(a.name)} — ${since}`;
  });
  return ['🔴 <b>Offline dentro do expediente</b>', ...lines].join('\n');
}
