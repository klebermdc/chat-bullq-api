import type { BusinessHoursConfig } from '../../routing/availability/business-hours.util';
import {
  buildDigestParams,
  buildScoreboardParams,
  selectOverdueWaits,
  summarizeScoreboard,
} from './manager-alerts.selection';

const TZ = 'America/Sao_Paulo';
const sp = (isoLocal: string) => new Date(`${isoLocal}-03:00`);
const MONDAY_9_18: BusinessHoursConfig = {
  monday: { enabled: true, windows: [['09:00', '18:00']] },
};

describe('selectOverdueWaits', () => {
  const now = sp('2026-11-09T10:00:00'); // segunda

  it('conta só minutos úteis do horário de cada espera', () => {
    const waits = [
      // 08:00 → 10:00, mas o expediente abre 09:00: 60 min úteis.
      { contactName: 'A', agentName: 'Pedro', waitingSince: sp('2026-11-09T08:00:00'), hours: MONDAY_9_18 },
      // 24/7: 20 min — abaixo do corte.
      { contactName: 'B', agentName: null, waitingSince: sp('2026-11-09T09:40:00'), hours: null },
      // 24/7: 45 min.
      { contactName: 'C', agentName: 'Suelen', waitingSince: sp('2026-11-09T09:15:00'), hours: null },
    ];
    const result = selectOverdueWaits(waits, TZ, now, 30);
    expect(result.map((w) => [w.contactName, Math.round(w.businessMinutes)])).toEqual([
      ['A', 60],
      ['C', 45],
    ]);
  });

  it('não altera a lista de entrada', () => {
    const waits = [{ contactName: 'A', agentName: null, waitingSince: sp('2026-11-09T08:00:00'), hours: null }];
    const copy = JSON.parse(JSON.stringify(waits));
    selectOverdueWaits(waits, TZ, now, 30);
    expect(JSON.parse(JSON.stringify(waits))).toEqual(copy);
  });
});

describe('buildDigestParams', () => {
  it('monta as 4 variáveis do alerta_sla_gestao', () => {
    const params = buildDigestParams('Renata Dias', [
      { contactName: 'Maria Silva', agentName: 'Pedro', businessMinutes: 52 },
      { contactName: 'João', agentName: 'Pedro', businessMinutes: 35 },
      { contactName: 'Ana', agentName: null, businessMinutes: 31 },
    ]);
    expect(params).toEqual(['Renata', '3', 'Pedro 2, sem dono 1', 'Maria Silva com Pedro, 52 min']);
  });
  it('com zero esperas (só no teste) usa "nenhum"', () => {
    expect(buildDigestParams('Rafael', [])).toEqual(['Rafael', '0', 'nenhum', 'nenhum']);
  });
});

describe('summarizeScoreboard', () => {
  const row = (agentId: string | null, agentName: string | null, ok: boolean) => ({
    agentId,
    agentName,
    respondedAt: ok ? new Date() : null,
    breached: !ok,
  });

  it('usa a mesma regra do dashboard (respondida e sem estouro = no prazo)', () => {
    const summary = summarizeScoreboard([
      row('u1', 'Renata', true),
      row('u1', 'Renata', true),
      row('u2', 'Pedro', true),
      row('u2', 'Pedro', false),
      row(null, null, false),
      { agentId: 'u2', agentName: 'Pedro', respondedAt: new Date(), breached: true },
    ]);
    expect(summary).toEqual({
      overall: { within: 3, total: 6 },
      agents: [
        { agentName: 'Renata', percent: 100 },
        { agentName: 'Pedro', percent: 33 },
      ],
    });
  });

  it('dia sem esperas devolve null (placar não sai)', () => {
    expect(summarizeScoreboard([])).toBeNull();
  });
});

describe('buildScoreboardParams', () => {
  it('monta as 3 variáveis do placar_sla_dia', () => {
    expect(
      buildScoreboardParams('Rafael Lima', {
        overall: { within: 41, total: 50 },
        agents: [
          { agentName: 'Renata', percent: 94 },
          { agentName: 'Pedro', percent: 71 },
        ],
      }),
    ).toEqual(['Rafael', '82% (41 de 50 no prazo)', 'Renata 94%, Pedro 71%']);
  });
  it('sem esperas (só no teste) usa "nenhum"', () => {
    expect(buildScoreboardParams('Rafael', null)).toEqual(['Rafael', 'nenhum', 'nenhum']);
  });
});
