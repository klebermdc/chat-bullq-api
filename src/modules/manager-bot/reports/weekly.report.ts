import { escapeHtml, formatDate, formatPercent } from '../manager-bot.format';
import type { Range } from '../manager-bot.rules';

export interface WeekMetrics {
  entered: number;
  closed: number;
  lost: number;
  slaPercent: number | null;
}

export interface WeeklyInput {
  tz: string;
  last: Range;
  lastMetrics: WeekMetrics;
  beforeMetrics: WeekMetrics;
  ranking: Array<{ agentName: string; percent: number }>;
}

const DAY_MS = 24 * 60 * 60_000;

function arrow(diff: number): string {
  if (diff > 0) return '▲';
  if (diff < 0) return '▼';
  return '=';
}

export function countDelta(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? '= vs 0' : `vs 0`;
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${arrow(pct)} ${Math.abs(pct)}% vs ${previous}`;
}

export function pointsDelta(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return `vs ${formatPercent(previous)}`;
  const pts = Math.round(current) - Math.round(previous);
  return `${arrow(pts)} ${Math.abs(pts)} pts vs ${formatPercent(previous)}`;
}

export function buildWeeklyReport(input: WeeklyInput): string {
  const { tz, last, lastMetrics: a, beforeMetrics: b } = input;
  const lastDay = new Date(last.to.getTime() - DAY_MS);
  const ranking = input.ranking.map((r, i) => `${i + 1}. ${escapeHtml(r.agentName)} — ${r.percent}%`);
  return [
    `📅 <b>Semana ${formatDate(last.from, tz)} a ${formatDate(lastDay, tz)}</b>`,
    '',
    `<b>Conversas novas:</b> ${a.entered} (${countDelta(a.entered, b.entered)})`,
    `<b>Finalizadas:</b> ${a.closed} (${countDelta(a.closed, b.closed)})`,
    `<b>Vendas perdidas:</b> ${a.lost} (${countDelta(a.lost, b.lost)})`,
    `<b>SLA:</b> ${formatPercent(a.slaPercent)} (${pointsDelta(a.slaPercent, b.slaPercent)})`,
    '',
    '<b>SLA por vendedor</b>',
    ...(ranking.length ? ranking : ['Sem esperas contadas.']),
  ].join('\n');
}
