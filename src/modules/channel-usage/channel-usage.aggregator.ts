export interface WindowRow {
  category: string;
  billable: boolean;
}

export interface UsageAggregate {
  total: number;
  byCategory: Record<string, number>;
  estimatedCost: number;
  currency: string;
}

/**
 * Contagem inclui TODAS as janelas. Custo soma só as `billable` × tarifa da
 * categoria (categoria sem tarifa cadastrada = custo 0).
 */
export function aggregateWindows(
  rows: WindowRow[],
  rates: Record<string, number>,
  currency: string,
): UsageAggregate {
  const byCategory: Record<string, number> = {};
  let estimatedCost = 0;

  for (const row of rows) {
    const cat = row.category || 'unknown';
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    if (row.billable) {
      estimatedCost += rates[cat] ?? 0;
    }
  }

  return {
    total: rows.length,
    byCategory,
    estimatedCost: Math.round(estimatedCost * 100) / 100,
    currency,
  };
}
