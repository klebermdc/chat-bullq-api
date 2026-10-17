import { UNKNOWN_CATEGORY } from './message-billing.mapper';
import { roundTo } from './round.util';
import { toZonedDayKey } from './zoned-day.util';

/** Categorias que sempre aparecem em `rates`, mesmo sem tarifa cadastrada. */
export const STANDARD_RATE_CATEGORIES = [
  'marketing',
  'utility',
  'authentication',
  'service',
] as const;
const SERVICE_CATEGORY = 'service';

/**
 * Contagem pré-agregada (o banco agrupa por hora cheia; São Paulo tem offset
 * de hora cheia, então o balde de hora nunca atravessa a virada do dia).
 * Uma mensagem avulsa também serve: `count: 1`.
 */
export interface BillingBucketRow {
  bucketAt: Date;
  category: string;
  pricingType: string | null;
  billable: boolean;
  count: number;
}

export interface BillingCategoryTotal {
  category: string;
  type: string | null;
  billable: boolean;
  count: number;
  estimatedCost: number;
}

export interface BillingDay {
  date: string;
  billable: Record<string, number>;
  free: Record<string, number>;
  estimatedCost: number;
}

export interface BillingResponse {
  currency: string;
  rates: Record<string, number>;
  totals: {
    messages: number;
    billable: number;
    free: number;
    estimatedCost: number;
    byCategory: BillingCategoryTotal[];
  };
  daily: BillingDay[];
  firstBillableServiceDate: string | null;
  projectedServiceCost: number;
}

export interface BillingAggregateInput {
  rows: BillingBucketRow[];
  rates: Record<string, number>;
  currency: string;
  /** Dias de São Paulo do intervalo — garante os dias sem mensagem (zeros). */
  dayKeys: string[];
  /** 1º status de atendimento cobrável da org (histórico todo), ou null. */
  firstBillableServiceAt: Date | null;
}

type CountByCategory = Record<string, number>;

function rateOf(rates: Record<string, number>, category: string): number {
  const rate = rates[category];
  return typeof rate === 'number' && Number.isFinite(rate) ? rate : 0;
}

function costOf(billable: CountByCategory, rates: Record<string, number>): number {
  const total = Object.entries(billable).reduce(
    (sum, [category, count]) => sum + count * rateOf(rates, category),
    0,
  );
  return roundTo(total);
}

function withStandardRates(rates: Record<string, number>): Record<string, number> {
  const filled: Record<string, number> = {};
  for (const category of STANDARD_RATE_CATEGORIES) {
    filled[category] = rateOf(rates, category);
  }
  return { ...filled, ...rates };
}

function sumCounts(counts: CountByCategory): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

export function aggregateBilling(input: BillingAggregateInput): BillingResponse {
  const { rows, rates, currency, dayKeys, firstBillableServiceAt } = input;

  const groups = new Map<string, BillingCategoryTotal>();
  const days = new Map<string, { billable: CountByCategory; free: CountByCategory }>();
  const totalBillable: CountByCategory = {};
  const totalFree: CountByCategory = {};
  for (const date of dayKeys) days.set(date, { billable: {}, free: {} });

  for (const row of rows) {
    const category = row.category || UNKNOWN_CATEGORY;
    const type = row.pricingType ?? null;
    const side = row.billable ? 'billable' : 'free';

    const groupKey = JSON.stringify([category, type, row.billable]);
    const group = groups.get(groupKey);
    groups.set(groupKey, {
      category,
      type,
      billable: row.billable,
      count: (group?.count ?? 0) + row.count,
      estimatedCost: 0,
    });

    const date = toZonedDayKey(row.bucketAt);
    const day = days.get(date) ?? { billable: {}, free: {} };
    days.set(date, {
      ...day,
      [side]: { ...day[side], [category]: (day[side][category] ?? 0) + row.count },
    });

    const total = row.billable ? totalBillable : totalFree;
    total[category] = (total[category] ?? 0) + row.count;
  }

  const categories = [
    ...new Set([...Object.keys(totalBillable), ...Object.keys(totalFree)]),
  ].sort();
  const zeroFilled = (counts: CountByCategory): CountByCategory =>
    Object.fromEntries(categories.map((c) => [c, counts[c] ?? 0]));

  const byCategory = [...groups.values()]
    .map((group) => ({
      ...group,
      estimatedCost: group.billable
        ? roundTo(group.count * rateOf(rates, group.category))
        : 0,
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.category.localeCompare(b.category) ||
        (a.type ?? '').localeCompare(b.type ?? ''),
    );

  const daily = [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, day]) => ({
      date,
      billable: zeroFilled(day.billable),
      free: zeroFilled(day.free),
      estimatedCost: costOf(day.billable, rates),
    }));

  const billable = sumCounts(totalBillable);
  const free = sumCounts(totalFree);

  return {
    currency,
    rates: withStandardRates(rates),
    totals: {
      messages: billable + free,
      billable,
      free,
      estimatedCost: costOf(totalBillable, rates),
      byCategory,
    },
    daily,
    firstBillableServiceDate: firstBillableServiceAt
      ? toZonedDayKey(firstBillableServiceAt)
      : null,
    projectedServiceCost: roundTo(
      (totalFree[SERVICE_CATEGORY] ?? 0) * rateOf(rates, SERVICE_CATEGORY),
    ),
  };
}
