import { escapeHtml, formatDate, formatDuration, minutesSince } from '../manager-bot.format';

export const MAX_LIST_LINES = 10;

export interface WaitLine {
  contactName: string;
  agentName: string | null;
  waitingSince: Date;
}

export interface TeamLine {
  name: string;
  configured: boolean;
  withinHours: boolean | null;
  /** Texto pronto do horário de volta ("hoje às 14h"). */
  returnsAt: string | null;
}

export interface OpeningInput {
  now: Date;
  tz: string;
  queue: { unassigned: number; oldestSince: string | null };
  waitingSinceYesterday: WaitLine[];
  team: TeamLine[];
  /** Linhas de custo do WhatsApp (já formatadas). */
  costLines?: string[];
}

export function waitLines(waits: ReadonlyArray<WaitLine>, now: Date): string[] {
  const sorted = [...waits].sort((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime());
  const lines = sorted
    .slice(0, MAX_LIST_LINES)
    .map(
      (w) =>
        `• ${escapeHtml(w.contactName)} — ${escapeHtml(w.agentName ?? 'sem dono')} — há ${formatDuration(minutesSince(w.waitingSince, now))}`,
    );
  const rest = sorted.length - lines.length;
  return rest > 0 ? [...lines, `… e mais ${rest}`] : lines;
}

function queueLine(queue: OpeningInput['queue'], now: Date): string {
  if (queue.unassigned === 0) return '<b>Fila sem dono:</b> vazia';
  const oldest = queue.oldestSince ? ` (mais antiga há ${formatDuration(minutesSince(queue.oldestSince, now))})` : '';
  return `<b>Fila sem dono:</b> ${queue.unassigned}${oldest}`;
}

function teamLines(team: ReadonlyArray<TeamLine>): string[] {
  const scheduled = team.filter((t) => t.configured);
  const working = scheduled.filter((t) => t.withinHours).map((t) => escapeHtml(t.name));
  const later = scheduled
    .filter((t) => !t.withinHours && t.returnsAt)
    .map((t) => `${escapeHtml(t.name)} (${escapeHtml(t.returnsAt as string)})`);
  return [
    `No expediente: ${working.length ? working.join(', ') : 'ninguém'}`,
    ...(later.length ? [`Entram depois: ${later.join(', ')}`] : []),
  ];
}

export function buildOpeningReport(input: OpeningInput): string {
  const { now, tz } = input;
  const waiting = input.waitingSinceYesterday;
  return [
    `☀️ <b>Abertura · ${formatDate(now, tz)}</b>`,
    '',
    queueLine(input.queue, now),
    `<b>Esperando desde ontem:</b> ${waiting.length || 'ninguém'}`,
    ...waitLines(waiting, now),
    '',
    '<b>Equipe</b>',
    ...teamLines(input.team),
    ...(input.costLines?.length ? ['', ...input.costLines] : []),
  ].join('\n');
}
