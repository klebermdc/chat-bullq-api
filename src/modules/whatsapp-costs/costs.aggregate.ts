import type { PricingPoint } from './meta-pricing.client';

/** Agregação pura dos pontos diários da Meta (sem banco nem rede). */

export const CHARGED_TYPE = 'REGULAR';
const HALF_DAY_SECONDS = 12 * 60 * 60;

export interface CategoryRow {
  category: string;
  type: string;
  volume: number;
  cost: number;
}

export interface CostDay {
  date: string;
  cost: number;
  billable: number;
  free: number;
  /** Só mensagens cobradas, por categoria. */
  byCategory: Record<string, { volume: number; cost: number }>;
}

export interface CostTotals {
  cost: number;
  billable: number;
  free: number;
  byCategory: CategoryRow[];
}

const round = (value: number, digits = 4): number => Number(value.toFixed(digits));

export function isCharged(point: Pick<PricingPoint, 'type' | 'cost'>): boolean {
  return point.type === CHARGED_TYPE || point.cost > 0;
}

/** A conta da Meta tem fuso próprio: o meio do bucket cai no dia certo do nosso fuso. */
export function pointDate(point: Pick<PricingPoint, 'start'>, tz: string): string {
  const middle = new Date((point.start + HALF_DAY_SECONDS) * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(middle);
}

/** Todas as datas YYYY-MM-DD de `from` a `to`, inclusive. */
export function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const last = new Date(`${to}T12:00:00Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function emptyDay(date: string): CostDay {
  return { date, cost: 0, billable: 0, free: 0, byCategory: {} };
}

function addToDay(day: CostDay, point: PricingPoint): CostDay {
  if (!isCharged(point)) return { ...day, free: day.free + point.volume };
  const prev = day.byCategory[point.category] ?? { volume: 0, cost: 0 };
  return {
    ...day,
    cost: round(day.cost + point.cost),
    billable: day.billable + point.volume,
    byCategory: {
      ...day.byCategory,
      [point.category]: { volume: prev.volume + point.volume, cost: round(prev.cost + point.cost) },
    },
  };
}

export function buildDaily(points: ReadonlyArray<PricingPoint>, tz: string, from: string, to: string): CostDay[] {
  const byDate = new Map(dateRange(from, to).map((d) => [d, emptyDay(d)]));
  for (const point of points) {
    const date = pointDate(point, tz);
    const day = byDate.get(date);
    if (day) byDate.set(date, addToDay(day, point));
  }
  return [...byDate.values()];
}

export function buildTotals(points: ReadonlyArray<PricingPoint>): CostTotals {
  const rows = new Map<string, CategoryRow>();
  for (const p of points) {
    const key = `${p.category}|${p.type}`;
    const prev = rows.get(key) ?? { category: p.category, type: p.type, volume: 0, cost: 0 };
    rows.set(key, { ...prev, volume: prev.volume + p.volume, cost: round(prev.cost + p.cost) });
  }
  const byCategory = [...rows.values()].sort((a, b) => b.cost - a.cost || b.volume - a.volume);
  const charged = byCategory.filter(isCharged);
  return {
    cost: round(charged.reduce((sum, r) => sum + r.cost, 0), 2),
    billable: charged.reduce((sum, r) => sum + r.volume, 0),
    free: byCategory.filter((r) => !isCharged(r)).reduce((sum, r) => sum + r.volume, 0),
    byCategory,
  };
}

/** Preço médio por mensagem cobrada de cada categoria, no próprio período. */
export function unitPrices(rows: ReadonlyArray<CategoryRow>): Record<string, number> {
  const acc = new Map<string, { volume: number; cost: number }>();
  for (const r of rows.filter(isCharged)) {
    const prev = acc.get(r.category) ?? { volume: 0, cost: 0 };
    acc.set(r.category, { volume: prev.volume + r.volume, cost: prev.cost + r.cost });
  }
  return Object.fromEntries(
    [...acc.entries()].filter(([, v]) => v.volume > 0).map(([k, v]) => [k, round(v.cost / v.volume)]),
  );
}
