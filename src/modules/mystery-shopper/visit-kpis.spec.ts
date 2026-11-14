import { buildKpis, type KpiInput, type KpiVisit } from './visit-kpis';
import type { CriterionScore, VisitMetrics } from './mystery-shopper.types';

const LABELS: Record<string, string> = {
  primeiraResposta: '1ª resposta',
  ocultoDescoberta: 'Descoberta',
  ocultoCotacao: 'Cotação adequada',
  ocultoInformacao: 'Informação correta',
  ocultoObjecao: 'Tratamento da objeção',
  ocultoFechamento: 'Fechamento e próximo passo',
  ocultoFollowUp: 'Follow-up',
};

const score = (criterion: string, value: CriterionScore['score'], label = LABELS[criterion]): CriterionScore =>
  ({ criterion, label, score: value, evidence: '', comment: '', measuredBy: 'AI' });

const METRICS: VisitMetrics = {
  firstHumanReplyMinutes: 10,
  humanMessages: 3,
  followUps: 0,
  firstFollowUpHours: null,
  proposalSent: false,
  lastShopperMessageAt: null,
};

let seq = 0;
function visit(overrides: Partial<Omit<KpiVisit, 'metrics'>> & { metrics?: Partial<VisitMetrics> } = {}): KpiVisit {
  seq += 1;
  return {
    id: `v${seq}`,
    sellerUserId: 'u1',
    totalScore: 70,
    scores: [],
    improvements: [],
    evaluatedAt: new Date(Date.UTC(2026, 10, 1, 0, seq)),
    ...overrides,
    metrics: { ...METRICS, ...overrides.metrics },
  };
}

const NAMES = new Map([['u1', 'Pedro'], ['u2', 'Renata']]);
const input = (overrides: Partial<KpiInput>): KpiInput =>
  ({ month: '2026-11', visits: [], previousVisits: [], openVisits: 0, names: NAMES, ...overrides });

describe('buildKpis — mês vazio', () => {
  test('sem visitas: nulos e zeros, sem vendedores', () => {
    const kpis = buildKpis(input({ openVisits: 2 }));

    expect(kpis.month).toBe('2026-11');
    expect(kpis.criteria).toEqual([]);
    expect(kpis.sellers).toEqual([]);
    expect(kpis.overall).toMatchObject({
      visits: 0,
      openVisits: 2,
      averageScore: null,
      previousAverageScore: null,
      approvedPct: null,
      medianFirstReplyMinutes: null,
      within15MinPct: null,
      criteriaAverages: [],
      weakestCriterion: null,
      criticalVisits: [],
    });
    expect(kpis.overall.funnel.map((f) => [f.key, f.reached, f.total, f.pct])).toEqual([
      ['responded', 0, 0, null],
      ['discovery', 0, 0, null],
      ['proposal', 0, 0, null],
      ['objection', 0, 0, null],
      ['closing', 0, 0, null],
      ['followUp', 0, 0, null],
    ]);
  });
});

describe('buildKpis — visão geral', () => {
  test('média, média do mês anterior e aprovadas (>= 70)', () => {
    const kpis = buildKpis(input({
      visits: [visit({ totalScore: 70 }), visit({ totalScore: 69 }), visit({ totalScore: 90 })],
      previousVisits: [visit({ totalScore: 50 }), visit({ totalScore: 61 })],
    }));

    expect(kpis.overall.visits).toBe(3);
    expect(kpis.overall.averageScore).toBe(76);
    expect(kpis.overall.previousAverageScore).toBe(56);
    expect(kpis.overall.approvedPct).toBe(67);
  });

  test('mediana da 1ª resposta: ímpar, par e ignora quem não respondeu', () => {
    const odd = buildKpis(input({ visits: [5, 40, 12].map((m) => visit({ metrics: { firstHumanReplyMinutes: m } })) }));
    const even = buildKpis(input({
      visits: [visit({ metrics: { firstHumanReplyMinutes: 10 } }), visit({ metrics: { firstHumanReplyMinutes: 15 } }), visit({ metrics: { firstHumanReplyMinutes: null } })],
    }));

    expect(odd.overall.medianFirstReplyMinutes).toBe(12);
    expect(even.overall.medianFirstReplyMinutes).toBe(12.5);
  });

  test('até 15 min: sem resposta conta como fora', () => {
    const kpis = buildKpis(input({
      visits: [15, 16, null, 3].map((m) => visit({ metrics: { firstHumanReplyMinutes: m } })),
    }));

    expect(kpis.overall.within15MinPct).toBe(50);
  });

  test('funil: numeradores e denominadores, objeção só sobre quem teve objeção', () => {
    const kpis = buildKpis(input({
      visits: [
        visit({
          scores: [score('ocultoDescoberta', 2), score('ocultoCotacao', 0), score('ocultoObjecao', 1), score('ocultoFechamento', 1)],
          metrics: { proposalSent: true, followUps: 2 },
        }),
        visit({
          scores: [score('ocultoDescoberta', 0), score('ocultoCotacao', 1), score('ocultoObjecao', 0), score('ocultoFechamento', 0)],
        }),
        visit({
          scores: [score('ocultoDescoberta', 1), score('ocultoCotacao', 0), score('ocultoObjecao', null)],
          metrics: { firstHumanReplyMinutes: null },
        }),
        visit({ scores: [], metrics: { followUps: 0 } }),
      ],
    }));

    expect(kpis.overall.funnel).toEqual([
      { key: 'responded', label: 'Respondeu', reached: 3, total: 4, pct: 75 },
      { key: 'discovery', label: 'Fez a descoberta', reached: 2, total: 4, pct: 50 },
      { key: 'proposal', label: 'Mandou proposta', reached: 2, total: 4, pct: 50 },
      { key: 'objection', label: 'Tratou a objeção', reached: 1, total: 2, pct: 50 },
      { key: 'closing', label: 'Puxou o fechamento', reached: 1, total: 4, pct: 25 },
      { key: 'followUp', label: 'Fez follow-up', reached: 1, total: 4, pct: 25 },
    ]);
  });

  test('médias por critério (rótulo mais recente) e ponto fraco', () => {
    const kpis = buildKpis(input({
      visits: [
        visit({ scores: [score('ocultoDescoberta', 2, 'Descoberta antiga'), score('ocultoTom', 2, 'Tom'), score('ocultoObjecao', null)] }),
        visit({ scores: [score('ocultoDescoberta', 1), score('ocultoTom', 0, 'Tom'), score('ocultoObjecao', null)] }),
        visit({ scores: [score('ocultoTom', 0, 'Tom')] }),
      ],
    }));

    expect(kpis.criteria).toEqual([
      { criterion: 'ocultoDescoberta', label: 'Descoberta' },
      { criterion: 'ocultoTom', label: 'Tom' },
      { criterion: 'ocultoObjecao', label: 'Tratamento da objeção' },
    ]);
    expect(kpis.overall.criteriaAverages).toEqual([
      { criterion: 'ocultoDescoberta', label: 'Descoberta', average: 1.5, rated: 2 },
      { criterion: 'ocultoTom', label: 'Tom', average: 0.7, rated: 3 },
      { criterion: 'ocultoObjecao', label: 'Tratamento da objeção', average: null, rated: 0 },
    ]);
    expect(kpis.overall.weakestCriterion).toEqual({ criterion: 'ocultoTom', label: 'Tom', average: 0.7 });
  });

  test('erros graves: sem resposta ou informação errada, mais recentes primeiro', () => {
    const kpis = buildKpis(input({
      visits: [
        visit({ id: 'a', evaluatedAt: new Date('2026-11-02T10:00:00Z'), metrics: { firstHumanReplyMinutes: null } }),
        visit({ id: 'b', evaluatedAt: new Date('2026-11-05T10:00:00Z'), scores: [score('ocultoInformacao', 0)] }),
        visit({ id: 'c', evaluatedAt: new Date('2026-11-06T10:00:00Z'), scores: [score('ocultoInformacao', 1)] }),
        visit({ id: 'd', sellerUserId: null, evaluatedAt: new Date('2026-11-07T10:00:00Z'), metrics: { firstHumanReplyMinutes: null } }),
        visit({ id: 'e', sellerUserId: 'gone', evaluatedAt: new Date('2026-11-03T10:00:00Z'), scores: [score('ocultoInformacao', 0)] }),
      ],
    }));

    expect(kpis.overall.criticalVisits).toEqual([
      { visitId: 'd', sellerName: 'Sem vendedor', reason: 'NO_REPLY', evaluatedAt: '2026-11-07T10:00:00.000Z' },
      { visitId: 'b', sellerName: 'Pedro', reason: 'WRONG_INFO', evaluatedAt: '2026-11-05T10:00:00.000Z' },
      { visitId: 'e', sellerName: 'Vendedor removido', reason: 'WRONG_INFO', evaluatedAt: '2026-11-03T10:00:00.000Z' },
      { visitId: 'a', sellerName: 'Pedro', reason: 'NO_REPLY', evaluatedAt: '2026-11-02T10:00:00.000Z' },
    ]);
  });
});

describe('buildKpis — por vendedor', () => {
  test('visita sem vendedor conta no geral, mas não vira linha', () => {
    const kpis = buildKpis(input({ visits: [visit({ sellerUserId: null, totalScore: 40 }), visit({ totalScore: 80 })] }));

    expect(kpis.overall.visits).toBe(2);
    expect(kpis.overall.averageScore).toBe(60);
    expect(kpis.sellers.map((s) => s.sellerUserId)).toEqual(['u1']);
  });

  test('linha completa, ordenada pela média', () => {
    const kpis = buildKpis(input({
      visits: [
        visit({ sellerUserId: 'u1', totalScore: 60, scores: [score('ocultoDescoberta', 2)], metrics: { proposalSent: true, firstHumanReplyMinutes: 30 } }),
        visit({ sellerUserId: 'u1', totalScore: 70, scores: [score('ocultoDescoberta', 1), score('ocultoCotacao', 1)], metrics: { followUps: 1, firstHumanReplyMinutes: 10 } }),
        visit({ sellerUserId: 'u1', totalScore: 80, scores: [score('ocultoCotacao', 0)], metrics: { firstHumanReplyMinutes: null } }),
        visit({ sellerUserId: 'u2', totalScore: 95, scores: [score('ocultoDescoberta', 2)] }),
      ],
    }));

    expect(kpis.sellers.map((s) => s.sellerName)).toEqual(['Renata', 'Pedro']);
    expect(kpis.sellers[1]).toEqual({
      sellerUserId: 'u1',
      sellerName: 'Pedro',
      visits: 3,
      averageScore: 70,
      previousAverageScore: null,
      trend: null,
      isSmallSample: false,
      byCriterion: { ocultoDescoberta: 1.5, ocultoCotacao: 0.5 },
      medianFirstReplyMinutes: 20,
      proposalPct: 67,
      followUpPct: 33,
      topImprovements: [],
    });
    expect(kpis.sellers[0]).toMatchObject({ isSmallSample: true, byCriterion: { ocultoDescoberta: 2, ocultoCotacao: null } });
  });

  test.each([
    [72, 70, 'SAME'],
    [68, 70, 'SAME'],
    [73, 70, 'UP'],
    [67, 70, 'DOWN'],
  ])('tendência: %i agora contra %i antes = %s', (now, before, trend) => {
    const kpis = buildKpis(input({
      visits: [visit({ totalScore: now })],
      previousVisits: [visit({ totalScore: before }), visit({ sellerUserId: 'u2', totalScore: 10 })],
    }));

    expect(kpis.sellers[0]).toMatchObject({ averageScore: now, previousAverageScore: before, trend });
  });

  test('a melhorar: os 2 mais repetidos (normalizado), empate fica com o mais recente', () => {
    const kpis = buildKpis(input({
      visits: [
        visit({ evaluatedAt: new Date('2026-11-01T10:00:00Z'), improvements: ['Perguntar datas', 'Mandar proposta'] }),
        visit({ evaluatedAt: new Date('2026-11-02T10:00:00Z'), improvements: ['  perguntar DATAS ', 'Fazer follow-up'] }),
        visit({ evaluatedAt: new Date('2026-11-03T10:00:00Z'), improvements: ['Puxar fechamento', '  '] }),
      ],
    }));

    expect(kpis.sellers[0].topImprovements).toEqual(['perguntar DATAS', 'Puxar fechamento']);
  });
});
