import type { DailyScoreboard, ScoreboardAgentRow } from '../../dashboard/daily-scoreboard/daily-scoreboard.rules';
import type { ScoreboardSummary } from '../../response-sla/manager-alerts/manager-alerts.selection';
import { escapeHtml, formatClock, formatDate, formatPercent } from '../manager-bot.format';

export interface LostCount {
  /** Rótulo já traduzido ("Preço / fora do orçamento"). */
  reason: string;
  count: number;
}

export interface ClosingInput {
  now: Date;
  tz: string;
  /** true = pedido no meio do dia (/placar): título diz "até HH:MM". */
  partial: boolean;
  scoreboard: Pick<DailyScoreboard, 'queue' | 'agents'>;
  sla: ScoreboardSummary | null;
  lost: LostCount[];
}

function hasActivity(a: ScoreboardAgentRow): boolean {
  return a.assignedToday + a.closedToday + a.awaitingReply + a.notStarted > 0;
}

function agentLine(a: ScoreboardAgentRow, slaByName: Map<string, number>): string {
  const parts = [
    `${a.assignedToday} recebidos (${a.assignedNewToday} novos, ${a.returnedToday} retorno)`,
    `${a.closedToday} finalizadas`,
    ...(a.notStarted ? [`${a.notStarted} não começou`] : []),
    ...(a.awaitingReply ? [`${a.awaitingReply} esperando`] : []),
  ];
  const sla = slaByName.get(a.agent.name);
  const slaText = sla === undefined ? '' : ` · SLA ${formatPercent(sla)}`;
  return `• <b>${escapeHtml(a.agent.name)}</b>: ${parts.join(', ')}${slaText}`;
}

function slaLine(sla: ScoreboardSummary | null): string {
  if (!sla) return '<b>SLA do dia:</b> sem esperas contadas';
  const { within, total } = sla.overall;
  return `<b>SLA do dia:</b> ${formatPercent((within / total) * 100)} (${within} de ${total} no prazo)`;
}

function lostLine(lost: ReadonlyArray<LostCount>): string {
  const total = lost.reduce((sum, l) => sum + l.count, 0);
  if (total === 0) return '<b>Vendas perdidas:</b> nenhuma';
  const detail = [...lost]
    .sort((a, b) => b.count - a.count)
    .map((l) => `${escapeHtml(l.reason)} ${l.count}`)
    .join(', ');
  return `<b>Vendas perdidas:</b> ${total} — ${detail}`;
}

export function buildClosingReport(input: ClosingInput): string {
  const { now, tz, scoreboard } = input;
  const title = input.partial
    ? `📊 <b>Placar até ${formatClock(now, tz)}</b>`
    : `🌙 <b>Fechamento · ${formatDate(now, tz)}</b>`;
  const slaByName = new Map((input.sla?.agents ?? []).map((a) => [a.agentName, a.percent]));
  const agents = scoreboard.agents.filter(hasActivity);
  return [
    title,
    '',
    `<b>Entraram hoje:</b> ${scoreboard.queue.enteredToday} · <b>fila sem dono agora:</b> ${scoreboard.queue.unassigned}`,
    slaLine(input.sla),
    lostLine(input.lost),
    '',
    '<b>Por vendedor</b>',
    ...(agents.length ? agents.map((a) => agentLine(a, slaByName)) : ['Sem movimento hoje.']),
  ].join('\n');
}
