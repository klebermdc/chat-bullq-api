import { aggregateWindows, WindowRow } from './channel-usage.aggregator';

const rows: WindowRow[] = [
  { category: 'marketing', billable: true },
  { category: 'marketing', billable: true },
  { category: 'service', billable: false },
  { category: 'utility', billable: true },
  { category: 'unknown', billable: true },
];

describe('aggregateWindows', () => {
  it('conta todas as janelas por categoria (incl. não-cobradas)', () => {
    const out = aggregateWindows(rows, { marketing: 0.35, utility: 0.1 }, 'BRL');
    expect(out.total).toBe(5);
    expect(out.byCategory).toEqual({ marketing: 2, service: 1, utility: 1, unknown: 1 });
  });

  it('soma custo só das janelas billable, tarifa ausente = 0', () => {
    const out = aggregateWindows(rows, { marketing: 0.35, utility: 0.1 }, 'BRL');
    expect(out.estimatedCost).toBeCloseTo(0.8, 5);
    expect(out.currency).toBe('BRL');
  });

  it('não quebra com lista vazia', () => {
    const out = aggregateWindows([], {}, 'BRL');
    expect(out.total).toBe(0);
    expect(out.estimatedCost).toBe(0);
    expect(out.byCategory).toEqual({});
  });
});
