import type { ScoreboardAgentRow } from '../../dashboard/daily-scoreboard/daily-scoreboard.rules';
import { buildClosingReport } from './closing.report';
import { buildOpeningReport } from './opening.report';
import { buildWeeklyReport, countDelta, pointsDelta } from './weekly.report';

const TZ = 'America/Sao_Paulo';
const NOW = new Date('2026-11-11T12:00:00Z'); // 09:00 em SP
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function agent(name: string, over: Partial<ScoreboardAgentRow> = {}): ScoreboardAgentRow {
  return {
    agent: { id: name, name, avatarUrl: null },
    assignedToday: 0,
    assignedNewToday: 0,
    returnedToday: 0,
    startedToday: 0,
    notStarted: 0,
    notStartedOldestSince: null,
    notStartedToday: 0,
    notStartedNewToday: 0,
    notStartedReturnedToday: 0,
    notStartedTodayOldestSince: null,
    awaitingReply: 0,
    awaitingOldestSince: null,
    awaitingReplyToday: 0,
    awaitingTodayOldestSince: null,
    closedToday: 0,
    openTotal: 0,
    avgPickupMinutes: null,
    ...over,
  };
}

describe('buildOpeningReport', () => {
  it('mostra fila, quem espera desde ontem (mais antigo primeiro) e a equipe', () => {
    const text = buildOpeningReport({
      now: NOW,
      tz: TZ,
      queue: { unassigned: 4, oldestSince: hoursAgo(3).toISOString() },
      waitingSinceYesterday: [
        { contactName: 'Ana', agentName: 'Pedro', waitingSince: hoursAgo(10) },
        { contactName: 'Bia <VIP>', agentName: null, waitingSince: hoursAgo(14) },
      ],
      team: [
        { name: 'Bárbara', configured: true, withinHours: true, returnsAt: null },
        { name: 'Marcella', configured: true, withinHours: false, returnsAt: 'hoje às 14h' },
        { name: 'Admin', configured: false, withinHours: null, returnsAt: null },
      ],
    });
    expect(text).toContain('Abertura · 11/11');
    expect(text).toContain('<b>Fila sem dono:</b> 4 (mais antiga há 3h00)');
    expect(text.indexOf('Bia &lt;VIP&gt; — sem dono — há 14h00')).toBeLessThan(text.indexOf('Ana — Pedro'));
    expect(text).toContain('No expediente: Bárbara');
    expect(text).toContain('Entram depois: Marcella (hoje às 14h)');
    expect(text).not.toContain('Admin');
  });

  it('corta a lista em 10 e diz quantos sobraram', () => {
    const waits = Array.from({ length: 13 }, (_, i) => ({
      contactName: `C${i}`,
      agentName: 'X',
      waitingSince: hoursAgo(20 - i),
    }));
    const text = buildOpeningReport({
      now: NOW,
      tz: TZ,
      queue: { unassigned: 0, oldestSince: null },
      waitingSinceYesterday: waits,
      team: [],
    });
    expect(text).toContain('<b>Fila sem dono:</b> vazia');
    expect(text).toContain('… e mais 3');
    expect(text).toContain('No expediente: ninguém');
  });
});

describe('buildClosingReport', () => {
  const base = {
    now: new Date('2026-11-12T01:10:00Z'), // 22:10 do dia 11 em SP
    tz: TZ,
    partial: false,
    scoreboard: {
      queue: { unassigned: 2, oldestSince: null, enteredToday: 40, unassignedToday: 1, unassignedTodayOldestSince: null },
      agents: [
        agent('Bárbara', { assignedToday: 12, assignedNewToday: 9, returnedToday: 3, closedToday: 8, notStarted: 2, awaitingReply: 1 }),
        agent('Parado'),
      ],
    },
    sla: { overall: { within: 40, total: 46 }, agents: [{ agentName: 'Bárbara', percent: 92 }] },
    lost: [
      { reason: 'Não respondeu', count: 3 },
      { reason: 'Preço / fora do orçamento', count: 2 },
    ],
  };

  it('monta o fechamento só com quem teve movimento', () => {
    const text = buildClosingReport(base);
    expect(text).toContain('Fechamento · 11/11');
    expect(text).toContain('<b>Entraram hoje:</b> 40 · <b>fila sem dono agora:</b> 2');
    expect(text).toContain('<b>SLA do dia:</b> 87% (40 de 46 no prazo)');
    expect(text).toContain('<b>Vendas perdidas:</b> 5 — Não respondeu 3, Preço / fora do orçamento 2');
    expect(text).toContain(
      '• <b>Bárbara</b>: 12 recebidos (9 novos, 3 retorno), 8 finalizadas, 2 não começou, 1 esperando · SLA 92%',
    );
    expect(text).not.toContain('Parado');
  });

  it('versão parcial e dia sem movimento', () => {
    const text = buildClosingReport({
      ...base,
      partial: true,
      sla: null,
      lost: [],
      scoreboard: { ...base.scoreboard, agents: [agent('Parado')] },
    });
    expect(text).toContain('Placar até 22:10');
    expect(text).toContain('sem esperas contadas');
    expect(text).toContain('<b>Vendas perdidas:</b> nenhuma');
    expect(text).toContain('Sem movimento hoje.');
  });
});

describe('weekly', () => {
  it('compara contagens e pontos de SLA', () => {
    expect(countDelta(110, 100)).toBe('▲ 10% vs 100');
    expect(countDelta(90, 100)).toBe('▼ 10% vs 100');
    expect(countDelta(5, 0)).toBe('vs 0');
    expect(pointsDelta(88, 91)).toBe('▼ 3 pts vs 91%');
    expect(pointsDelta(null, 91)).toBe('vs 91%');
  });

  it('monta o semanal com o ranking', () => {
    const text = buildWeeklyReport({
      tz: TZ,
      last: { from: new Date('2026-11-09T03:00:00Z'), to: new Date('2026-11-16T03:00:00Z') },
      lastMetrics: { entered: 320, closed: 200, lost: 30, slaPercent: 88 },
      beforeMetrics: { entered: 286, closed: 210, lost: 30, slaPercent: 91 },
      ranking: [{ agentName: 'Bárbara', percent: 95 }],
    });
    expect(text).toContain('Semana 09/11 a 15/11');
    expect(text).toContain('<b>Conversas novas:</b> 320 (▲ 12% vs 286)');
    expect(text).toContain('<b>Vendas perdidas:</b> 30 (= 0% vs 30)');
    expect(text).toContain('1. Bárbara — 95%');
  });
});
