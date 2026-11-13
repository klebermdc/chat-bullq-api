import {
  applyCodeRules,
  buildVisitPrompt,
  hasForeignScript,
  noReplyEvaluation,
  parseVisitEvaluation,
  totalScore,
  withoutForeignScript,
} from './visit-evaluation';
import type { CriterionScore, VisitCriterion, VisitLine, VisitMetrics } from './mystery-shopper.types';

const criteria: VisitCriterion[] = [
  { name: 'ocultoDescoberta', description: 'Descoberta', instructions: 'Pergunta datas e pessoas.' },
  { name: 'ocultoObjecao', description: 'Objeção', instructions: 'Trata a objeção.' },
  { name: 'ocultoFollowUp', description: 'Follow-up', instructions: 'Retoma o contato.' },
];
const lines: VisitLine[] = [
  { messageId: 'm1', role: 'CLIENTE', text: 'Quero ir a Orlando em julho', createdAt: new Date('2026-11-13T10:00:00Z') },
  { messageId: 'm2', role: 'VENDEDOR', text: 'Que ótimo! Quantas pessoas vão e quais as idades?', createdAt: new Date('2026-11-13T10:05:00Z') },
];
const metrics: VisitMetrics = {
  firstHumanReplyMinutes: 5,
  humanMessages: 1,
  followUps: 0,
  firstFollowUpHours: null,
  proposalSent: false,
  lastShopperMessageAt: '2026-11-13T10:00:00.000Z',
};
const answer = JSON.stringify({
  notas: [
    { criterio: 'ocultoDescoberta', nota: 2, trecho: 'Quantas pessoas vão e quais as idades?', comentario: 'Perguntou o essencial.' },
    { criterio: 'ocultoObjecao', nota: null, trecho: '', comentario: 'Não houve objeção.' },
    { criterio: 'ocultoFollowUp', nota: 1, trecho: '', comentario: 'x' },
  ],
  resumo: 'Bom começo.',
  fortes: ['Descoberta', 'Rapidez', 'extra'],
  melhorar: ['Follow-up'],
});

describe('buildVisitPrompt', () => {
  test('leva cenário, fatos medidos, critérios e a conversa marcada por papel', () => {
    const prompt = buildVisitPrompt({ sellerName: 'Pedro', scenario: 'família de 4', criteria, productRules: null, metrics, lines });
    expect(prompt.system).toContain('ocultoDescoberta');
    expect(prompt.system).toContain('português do Brasil');
    expect(prompt.user).toContain('família de 4');
    expect(prompt.user).toContain('[VENDEDOR]');
    expect(prompt.user).toContain('Proposta enviada: não');
  });
});

describe('parseVisitEvaluation', () => {
  test('lê notas 0–2, null = não se aplica, corta pontos em 2', () => {
    const evaluation = parseVisitEvaluation(answer, criteria, lines);
    expect(evaluation?.scores.map((s) => s.score)).toEqual([2, null, 1]);
    expect(evaluation?.scores[0].evidence).toBe('Quantas pessoas vão e quais as idades?');
    expect(evaluation?.summary.strengths).toEqual(['Descoberta', 'Rapidez']);
  });

  test('trecho que não é fala do vendedor é descartado', () => {
    const fake = answer.replace('Quantas pessoas vão e quais as idades?', 'Quero ir a Orlando em julho');
    expect(parseVisitEvaluation(fake, criteria, lines)?.scores[0].evidence).toBe('');
  });

  test('critério ausente na resposta = null (não infla a nota)', () => {
    const missing = JSON.parse(answer);
    missing.notas = missing.notas.filter((n: { criterio: string }) => n.criterio !== 'ocultoDescoberta');
    expect(parseVisitEvaluation(JSON.stringify(missing), criteria, lines)).toBeNull();
  });

  test('nota em string numérica é aceita', () => {
    const asString = answer.replace('"nota":2', '"nota":"2"');
    expect(parseVisitEvaluation(asString, criteria, lines)?.scores[0].score).toBe(2);
  });

  test('null fora da objeção = null; nota inválida também', () => {
    const nullOnDiscovery = answer.replace('"nota":2', '"nota":null');
    expect(parseVisitEvaluation(nullOnDiscovery, criteria, lines)).toBeNull();
    expect(parseVisitEvaluation(answer.replace('"nota":2', '"nota":1.5'), criteria, lines)).toBeNull();
    expect(parseVisitEvaluation(answer.replace('"nota":2', '"nota":3'), criteria, lines)).toBeNull();
  });

  test('null na objeção continua valendo', () => {
    expect(parseVisitEvaluation(answer, criteria, lines)?.scores[1].score).toBeNull();
  });

  test('resposta ilegível ou sem resumo = null', () => {
    expect(parseVisitEvaluation('não sei', criteria, lines)).toBeNull();
    expect(parseVisitEvaluation('{"notas":[]}', criteria, lines)).toBeNull();
  });
});

describe('applyCodeRules', () => {
  test('acrescenta a 1ª resposta e zera follow-up quando não houve', () => {
    const evaluation = parseVisitEvaluation(answer, criteria, lines);
    const scores = applyCodeRules(evaluation?.scores ?? [], metrics);
    expect(scores[0]).toMatchObject({ criterion: 'primeiraResposta', score: 2, measuredBy: 'CODE' });
    expect(scores.find((s) => s.criterion === 'ocultoFollowUp')).toMatchObject({ score: 0, measuredBy: 'CODE' });
  });
});

describe('totalScore', () => {
  const s = (score: CriterionScore['score']): CriterionScore =>
    ({ criterion: 'x', label: 'x', score, evidence: '', comment: '', measuredBy: 'AI' });

  test('soma / máximo, ignorando os que não se aplicam', () => {
    expect(totalScore([s(2), s(1), s(null)])).toBe(75);
    expect(totalScore([s(null)])).toBeNull();
  });
});

describe('noReplyEvaluation', () => {
  test('vendedor calado zera tudo sem chamar a IA', () => {
    const evaluation = noReplyEvaluation(criteria);
    expect(evaluation.scores.every((s) => s.score === 0)).toBe(true);
    expect(evaluation.summary.summary).toContain('não respondeu');
  });
});

describe('idioma', () => {
  test('detecta e remove caracteres de outro idioma', () => {
    const evaluation = parseVisitEvaluation(answer.replace('Bom começo.', 'Bom começo 很好'), criteria, lines);
    expect(evaluation && hasForeignScript(evaluation)).toBe(true);
    expect(evaluation && withoutForeignScript(evaluation).summary.summary).toBe('Bom começo');
  });

  test.each([
    ['Bom 很好。', 'Bom'],
    ['Bom مرحبا', 'Bom'],
    ['Bom ｏｋ！', 'Bom'],
    ['Bom привет', 'Bom'],
    ['Bom ありがとう', 'Bom'],
    ['Bom 안녕', 'Bom'],
  ])('remove %s', (input, expected) => {
    const evaluation = parseVisitEvaluation(answer.replace('Bom começo.', input), criteria, lines);
    expect(evaluation && hasForeignScript(evaluation)).toBe(true);
    expect(evaluation && withoutForeignScript(evaluation).summary.summary).toBe(expected);
  });
});
