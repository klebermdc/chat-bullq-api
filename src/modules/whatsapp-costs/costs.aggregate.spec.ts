import { buildDaily, buildTotals, dateRange, pointDate, unitPrices } from './costs.aggregate';
import type { PricingPoint } from './meta-pricing.client';

const TZ = 'America/Sao_Paulo';
// 12/11/2026 00:00 BRT (conta BRL) e 00:00 EST (conta USD, 1h depois).
const D12_BRT = 1794538800 - 86400;
const D12_EST = D12_BRT + 3600;

function point(over: Partial<PricingPoint>): PricingPoint {
  return { start: D12_BRT, end: D12_BRT + 86400, category: 'SERVICE', type: 'REGULAR', volume: 0, cost: 0, ...over };
}

describe('costs.aggregate', () => {
  it('põe o bucket da Meta no dia local, mesmo com conta em outro fuso', () => {
    expect(pointDate({ start: D12_BRT }, TZ)).toBe('2026-11-12');
    expect(pointDate({ start: D12_EST }, TZ)).toBe('2026-11-12');
  });

  it('lista todos os dias do período, inclusive', () => {
    expect(dateRange('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('separa cobradas de grátis e soma por categoria', () => {
    const points = [
      point({ volume: 1417, cost: 49.56 }),
      point({ category: 'MARKETING', volume: 56, cost: 18.0152 }),
      point({ type: 'FREE_ENTRY_POINT', volume: 380 }),
    ];
    const totals = buildTotals(points);
    expect(totals.cost).toBe(67.58);
    expect(totals.billable).toBe(1473);
    expect(totals.free).toBe(380);
    expect(totals.byCategory[0]).toEqual({ category: 'SERVICE', type: 'REGULAR', volume: 1417, cost: 49.56 });

    const daily = buildDaily(points, TZ, '2026-11-11', '2026-11-12');
    expect(daily).toHaveLength(2);
    expect(daily[0]).toEqual({ date: '2026-11-11', cost: 0, billable: 0, free: 0, byCategory: {} });
    expect(daily[1].byCategory.MARKETING).toEqual({ volume: 56, cost: 18.0152 });
    expect(daily[1].free).toBe(380);
  });

  it('ignora pontos fora do período', () => {
    expect(buildDaily([point({ volume: 3, cost: 1 })], TZ, '2026-11-13', '2026-11-13')[0].cost).toBe(0);
  });

  it('preço médio por categoria só com as cobradas', () => {
    const prices = unitPrices(buildTotals([
      point({ volume: 100, cost: 3.5 }),
      point({ category: 'MARKETING', volume: 10, cost: 3.217 }),
      point({ type: 'FREE_ENTRY_POINT', volume: 999 }),
    ]).byCategory);
    expect(prices).toEqual({ SERVICE: 0.035, MARKETING: 0.3217 });
  });
});
