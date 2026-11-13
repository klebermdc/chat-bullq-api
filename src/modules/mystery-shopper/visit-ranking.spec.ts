import { buildRanking } from './visit-ranking';
import type { CriterionScore } from './mystery-shopper.types';

const score = (label: string, value: CriterionScore['score']): CriterionScore =>
  ({ criterion: label, label, score: value, evidence: '', comment: '', measuredBy: 'AI' });

describe('buildRanking', () => {
  test('média por vendedor, amostra pequena e média por critério', () => {
    const rows = buildRanking(
      [
        { sellerUserId: 'u1', totalScore: 80, scores: [score('Descoberta', 2), score('Objeção', null)] },
        { sellerUserId: 'u1', totalScore: 60, scores: [score('Descoberta', 1), score('Objeção', 0)] },
        { sellerUserId: 'u1', totalScore: 70, scores: [score('Descoberta', 2)] },
        { sellerUserId: 'u2', totalScore: 90, scores: [score('Descoberta', 2)] },
      ],
      new Map([['u1', 'Pedro'], ['u2', 'Renata']]),
    );

    expect(rows.map((r) => r.sellerName)).toEqual(['Renata', 'Pedro']);
    expect(rows[1]).toMatchObject({ visits: 3, average: 70, isSmallSample: false });
    expect(rows[1].byCriterion).toEqual({ Descoberta: 1.7, Objeção: 0 });
    expect(rows[0].isSmallSample).toBe(true);
  });
});
