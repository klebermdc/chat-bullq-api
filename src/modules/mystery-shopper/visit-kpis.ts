import {
  APPROVED_SCORE,
  CLOSING_CRITERION,
  DISCOVERY_CRITERION,
  FIRST_REPLY_GOOD_MINUTES,
  INFORMATION_CRITERION,
  MAX_TOP_IMPROVEMENTS,
  OBJECTION_CRITERION,
  PROPOSAL_CRITERION,
  SMALL_SAMPLE_VISITS,
  TREND_SAME_POINTS,
} from './mystery-shopper.constants';
import type { CriterionScore, VisitMetrics } from './mystery-shopper.types';

/** Visita DONE já avaliada, só com o que os indicadores usam. */
export interface KpiVisit {
  id: string;
  sellerUserId: string | null;
  totalScore: number;
  scores: CriterionScore[];
  metrics: VisitMetrics;
  improvements: string[];
  evaluatedAt: Date;
}

export interface KpiInput {
  month: string;
  /** Visitas DONE avaliadas no mês. */
  visits: KpiVisit[];
  /** Visitas DONE avaliadas no mês anterior (só para tendência). */
  previousVisits: KpiVisit[];
  /** OPEN/EVALUATING criadas no mês. */
  openVisits: number;
  names: Map<string, string>;
}

export type FunnelKey = 'responded' | 'discovery' | 'proposal' | 'objection' | 'closing' | 'followUp';
export type Trend = 'UP' | 'DOWN' | 'SAME';

export interface CriterionColumn { criterion: string; label: string }
export interface FunnelStep { key: FunnelKey; label: string; reached: number; total: number; pct: number | null }
export interface CriterionAverage extends CriterionColumn { average: number | null; rated: number }
export interface CriticalVisit { visitId: string; sellerName: string; reason: 'NO_REPLY' | 'WRONG_INFO'; evaluatedAt: string }

export interface KpiOverall {
  visits: number;
  openVisits: number;
  averageScore: number | null;
  previousAverageScore: number | null;
  approvedPct: number | null;
  medianFirstReplyMinutes: number | null;
  within15MinPct: number | null;
  funnel: FunnelStep[];
  criteriaAverages: CriterionAverage[];
  weakestCriterion: { criterion: string; label: string; average: number } | null;
  criticalVisits: CriticalVisit[];
}

export interface SellerKpis {
  sellerUserId: string;
  sellerName: string;
  visits: number;
  averageScore: number;
  previousAverageScore: number | null;
  trend: Trend | null;
  isSmallSample: boolean;
  byCriterion: Record<string, number | null>;
  medianFirstReplyMinutes: number | null;
  proposalPct: number;
  followUpPct: number;
  topImprovements: string[];
}

export interface MysteryShopperKpis {
  month: string;
  criteria: CriterionColumn[];
  overall: KpiOverall;
  sellers: SellerKpis[];
}

const NO_SELLER = 'Sem vendedor';
const REMOVED_SELLER = 'Vendedor removido';

const mean = (values: number[]) => values.reduce((a, v) => a + v, 0) / values.length;
const oneDecimal = (n: number) => Math.round(n * 10) / 10;
const roundedMean = (values: number[]) => (values.length ? Math.round(mean(values)) : null);
const pct = (reached: number, total: number) => (total ? Math.round((reached / total) * 100) : null);
const countWhere = <T>(items: T[], test: (item: T) => boolean) => items.filter(test).length;
const chronological = (visits: KpiVisit[]) => [...visits].sort((a, b) => a.evaluatedAt.getTime() - b.evaluatedAt.getTime());

export const scoreOf = (visit: KpiVisit, criterion: string) =>
  visit.scores.find((s) => s.criterion === criterion)?.score ?? null;
const reachedOne = (visit: KpiVisit, criterion: string) => (scoreOf(visit, criterion) ?? 0) >= 1;
const hasReply = (visit: KpiVisit) => visit.metrics.firstHumanReplyMinutes !== null;
const sentProposal = (visit: KpiVisit) => visit.metrics.proposalSent || reachedOne(visit, PROPOSAL_CRITERION);
const didFollowUp = (visit: KpiVisit) => visit.metrics.followUps > 0;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return oneDecimal(value);
}

const medianFirstReply = (visits: KpiVisit[]) =>
  median(visits.flatMap((v) => (v.metrics.firstHumanReplyMinutes === null ? [] : [v.metrics.firstHumanReplyMinutes])));

/** Colunas na ordem em que aparecem; o rótulo é o da visita mais recente (chave = critério). */
function criteriaColumns(visits: KpiVisit[]): CriterionColumn[] {
  const labels = new Map<string, string>();
  visits.flatMap((v) => v.scores).forEach((s) => labels.set(s.criterion, s.label));
  return [...labels].map(([criterion, label]) => ({ criterion, label }));
}

function criterionAverage(visits: KpiVisit[], criterion: string): { average: number | null; rated: number } {
  const rated = visits.flatMap((v) => {
    const value = scoreOf(v, criterion);
    return value === null ? [] : [value];
  });
  return { average: rated.length ? oneDecimal(mean(rated)) : null, rated: rated.length };
}

const FUNNEL: Array<{ key: FunnelKey; label: string; reached: (v: KpiVisit) => boolean }> = [
  { key: 'responded', label: 'Respondeu', reached: hasReply },
  { key: 'discovery', label: 'Fez a descoberta', reached: (v) => reachedOne(v, DISCOVERY_CRITERION) },
  { key: 'proposal', label: 'Mandou proposta', reached: sentProposal },
  { key: 'objection', label: 'Tratou a objeção', reached: (v) => reachedOne(v, OBJECTION_CRITERION) },
  { key: 'closing', label: 'Puxou o fechamento', reached: (v) => reachedOne(v, CLOSING_CRITERION) },
  { key: 'followUp', label: 'Fez follow-up', reached: didFollowUp },
];

/** Denominador = visitas do mês; na objeção, só as que tiveram objeção (nota não nula). */
function funnel(visits: KpiVisit[]): FunnelStep[] {
  return FUNNEL.map(({ key, label, reached }) => {
    const base = key === 'objection' ? visits.filter((v) => scoreOf(v, OBJECTION_CRITERION) !== null) : visits;
    const count = countWhere(base, reached);
    return { key, label, reached: count, total: base.length, pct: pct(count, base.length) };
  });
}

function weakest(averages: CriterionAverage[]): KpiOverall['weakestCriterion'] {
  const rated = averages.filter((a) => a.rated >= 1 && a.average !== null);
  if (!rated.length) return null;
  const lowest = rated.reduce((min, a) => ((a.average as number) < (min.average as number) ? a : min));
  return { criterion: lowest.criterion, label: lowest.label, average: lowest.average as number };
}

function sellerName(sellerUserId: string | null, names: Map<string, string>): string {
  if (!sellerUserId) return NO_SELLER;
  return names.get(sellerUserId) ?? REMOVED_SELLER;
}

/** Sem resposta humana ou informação errada (nota 0). Mais recentes primeiro. */
function criticalVisits(visits: KpiVisit[], names: Map<string, string>): CriticalVisit[] {
  return visits
    .flatMap((v): CriticalVisit[] => {
      const reason = !hasReply(v) ? 'NO_REPLY' : scoreOf(v, INFORMATION_CRITERION) === 0 ? 'WRONG_INFO' : null;
      if (!reason) return [];
      return [{ visitId: v.id, sellerName: sellerName(v.sellerUserId, names), reason, evaluatedAt: v.evaluatedAt.toISOString() }];
    })
    .sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt));
}

function overall(input: KpiInput, visits: KpiVisit[], columns: CriterionColumn[]): KpiOverall {
  const total = visits.length;
  const averages = columns.map((c) => ({ ...c, ...criterionAverage(visits, c.criterion) }));
  const within15 = countWhere(visits, (v) => hasReply(v) && (v.metrics.firstHumanReplyMinutes as number) <= FIRST_REPLY_GOOD_MINUTES);
  return {
    visits: total,
    openVisits: input.openVisits,
    averageScore: roundedMean(visits.map((v) => v.totalScore)),
    previousAverageScore: roundedMean(input.previousVisits.map((v) => v.totalScore)),
    approvedPct: pct(countWhere(visits, (v) => v.totalScore >= APPROVED_SCORE), total),
    medianFirstReplyMinutes: medianFirstReply(visits),
    within15MinPct: pct(within15, total),
    funnel: funnel(visits),
    criteriaAverages: averages,
    weakestCriterion: weakest(averages),
    criticalVisits: criticalVisits(visits, input.names),
  };
}

function trend(current: number, previous: number | null): Trend | null {
  if (previous === null) return null;
  const diff = current - previous;
  if (Math.abs(diff) < TREND_SAME_POINTS) return 'SAME';
  return diff > 0 ? 'UP' : 'DOWN';
}

/**
 * Os "a melhorar" mais repetidos (comparados sem espaços nas pontas e em minúsculas).
 * Empate: o que apareceu por último. Mostra o texto da ocorrência mais recente.
 */
export function topImprovements(visits: KpiVisit[]): string[] {
  const items = visits.flatMap((v) => v.improvements.map((text) => text.trim())).filter((text) => text !== '');
  const tally = items.reduce((acc, text, position) => {
    const key = text.toLowerCase();
    return new Map(acc).set(key, { text, count: (acc.get(key)?.count ?? 0) + 1, lastSeen: position });
  }, new Map<string, { text: string; count: number; lastSeen: number }>());
  return [...tally.values()]
    .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)
    .slice(0, MAX_TOP_IMPROVEMENTS)
    .map((entry) => entry.text);
}

function sellerRow(sellerUserId: string, input: KpiInput, visits: KpiVisit[], columns: CriterionColumn[]): SellerKpis {
  const own = visits.filter((v) => v.sellerUserId === sellerUserId);
  const averageScore = roundedMean(own.map((v) => v.totalScore)) as number;
  const previousAverageScore = roundedMean(
    input.previousVisits.filter((v) => v.sellerUserId === sellerUserId).map((v) => v.totalScore),
  );
  return {
    sellerUserId,
    sellerName: sellerName(sellerUserId, input.names),
    visits: own.length,
    averageScore,
    previousAverageScore,
    trend: trend(averageScore, previousAverageScore),
    isSmallSample: own.length <= SMALL_SAMPLE_VISITS,
    byCriterion: Object.fromEntries(columns.map((c) => [c.criterion, criterionAverage(own, c.criterion).average])),
    medianFirstReplyMinutes: medianFirstReply(own),
    proposalPct: pct(countWhere(own, sentProposal), own.length) as number,
    followUpPct: pct(countWhere(own, didFollowUp), own.length) as number,
    topImprovements: topImprovements(own),
  };
}

/**
 * Indicadores do mês só com o que o cliente oculto viu. Visita sem vendedor conta
 * no geral, mas não vira linha em `sellers`.
 */
export function buildKpis(input: KpiInput): MysteryShopperKpis {
  const visits = chronological(input.visits);
  const columns = criteriaColumns(visits);
  const sellerIds = [...new Set(visits.flatMap((v) => (v.sellerUserId ? [v.sellerUserId] : [])))];
  return {
    month: input.month,
    criteria: columns,
    overall: overall(input, visits, columns),
    sellers: sellerIds
      .map((id) => sellerRow(id, input, visits, columns))
      .sort((a, b) => b.averageScore - a.averageScore),
  };
}
