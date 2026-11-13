import { SMALL_SAMPLE_VISITS } from './mystery-shopper.constants';
import type { CriterionScore } from './mystery-shopper.types';

export interface RankingVisit {
  sellerUserId: string;
  totalScore: number;
  scores: CriterionScore[];
}

export interface RankingRow {
  sellerUserId: string;
  sellerName: string;
  visits: number;
  average: number;
  isSmallSample: boolean;
  /** Média 0–2 por critério (rótulo), uma casa decimal. */
  byCriterion: Record<string, number>;
}

const average = (values: number[]) => values.reduce((a, v) => a + v, 0) / values.length;

/**
 * Agrupa pela chave do critério (o rótulo pode ter sido renomeado) e mostra o rótulo
 * da visita mais recente. Premissa: `visits` chega em ordem cronológica, a mais nova por último.
 */
function criterionAverages(visits: RankingVisit[]): Record<string, number> {
  const rated = visits.flatMap((v) => v.scores).filter((s) => s.score !== null);
  const latestLabel = new Map(rated.map((s) => [s.criterion, s.label]));
  return Object.fromEntries(
    [...latestLabel].map(([criterion, label]) => [
      label,
      Math.round(average(rated.filter((s) => s.criterion === criterion).map((s) => s.score ?? 0)) * 10) / 10,
    ]),
  );
}

export function buildRanking(visits: RankingVisit[], names: Map<string, string>): RankingRow[] {
  const sellers = [...new Set(visits.map((v) => v.sellerUserId))];
  return sellers
    .map((sellerUserId) => {
      const own = visits.filter((v) => v.sellerUserId === sellerUserId);
      return {
        sellerUserId,
        sellerName: names.get(sellerUserId) ?? 'Vendedor removido',
        visits: own.length,
        average: Math.round(average(own.map((v) => v.totalScore))),
        isSmallSample: own.length <= SMALL_SAMPLE_VISITS,
        byCriterion: criterionAverages(own),
      };
    })
    .sort((a, b) => b.average - a.average);
}
