import {
  aggregateBilling,
  BillingBucketRow,
} from './message-billing.aggregator';

const RATES = { marketing: 0.35, utility: 0.05, service: 0.1 };
const DAYS = ['2026-10-01', '2026-10-02', '2026-10-03'];

function row(
  at: string,
  category: string,
  pricingType: string | null,
  billable: boolean,
  count: number,
): BillingBucketRow {
  return { bucketAt: new Date(at), category, pricingType, billable, count };
}

function run(rows: BillingBucketRow[], overrides: Record<string, any> = {}) {
  return aggregateBilling({
    rows,
    rates: RATES,
    currency: 'BRL',
    dayKeys: DAYS,
    firstBillableServiceAt: null,
    ...overrides,
  });
}

describe('aggregateBilling', () => {
  it('sem mensagens: zera tudo e ainda devolve todos os dias', () => {
    const out = run([]);
    expect(out.totals).toEqual({
      messages: 0,
      billable: 0,
      free: 0,
      estimatedCost: 0,
      byCategory: [],
    });
    expect(out.daily).toEqual(
      DAYS.map((date) => ({ date, billable: {}, free: {}, estimatedCost: 0 })),
    );
    expect(out.firstBillableServiceDate).toBeNull();
    expect(out.projectedServiceCost).toBe(0);
  });

  it('devolve moeda e tarifas com as 4 categorias padrão preenchidas', () => {
    const out = run([]);
    expect(out.currency).toBe('BRL');
    expect(out.rates).toEqual({
      marketing: 0.35,
      utility: 0.05,
      authentication: 0,
      service: 0.1,
    });
  });

  it('custo = cobráveis × tarifa da categoria; grátis custa 0', () => {
    const out = run([
      row('2026-10-01T15:00:00Z', 'marketing', 'regular', true, 4),
      row('2026-10-01T15:00:00Z', 'utility', 'regular', true, 2),
      row('2026-10-01T16:00:00Z', 'service', 'free_customer_service', false, 77),
      row('2026-10-02T16:00:00Z', 'referral_conversion', 'free_entry_point', false, 125),
    ]);
    expect(out.totals.messages).toBe(208);
    expect(out.totals.billable).toBe(6);
    expect(out.totals.free).toBe(202);
    expect(out.totals.estimatedCost).toBe(1.5); // 4×0,35 + 2×0,05
  });

  it('categoria sem tarifa cadastrada custa 0', () => {
    const out = run([
      row('2026-10-01T15:00:00Z', 'authentication', 'regular', true, 10),
    ]);
    expect(out.totals.billable).toBe(10);
    expect(out.totals.estimatedCost).toBe(0);
  });

  it('byCategory agrupa por (categoria, tipo, cobrável) somando os baldes', () => {
    const out = run([
      row('2026-10-01T15:00:00Z', 'service', 'free_customer_service', false, 3),
      row('2026-10-02T15:00:00Z', 'service', 'free_customer_service', false, 2),
      row('2026-10-02T15:00:00Z', 'service', 'regular', true, 4),
      row('2026-10-02T15:00:00Z', 'marketing', 'regular', true, 1),
    ]);
    expect(out.totals.byCategory).toEqual([
      { category: 'service', type: 'free_customer_service', billable: false, count: 5, estimatedCost: 0 },
      { category: 'service', type: 'regular', billable: true, count: 4, estimatedCost: 0.4 },
      { category: 'marketing', type: 'regular', billable: true, count: 1, estimatedCost: 0.35 },
    ]);
  });

  it('agrupa por dia de São Paulo: 02:00 UTC ainda é o dia anterior', () => {
    const out = run([
      row('2026-10-02T02:00:00Z', 'marketing', 'regular', true, 1), // 23h do dia 01
      row('2026-10-02T03:00:00Z', 'marketing', 'regular', true, 2), // 00h do dia 02
    ]);
    expect(out.daily.map((d) => [d.date, d.billable.marketing])).toEqual([
      ['2026-10-01', 1],
      ['2026-10-02', 2],
      ['2026-10-03', 0],
    ]);
  });

  it('todo dia traz as mesmas categorias (zero quando não houve) e o custo do dia', () => {
    const out = run([
      row('2026-10-01T15:00:00Z', 'marketing', 'regular', true, 4),
      row('2026-10-02T15:00:00Z', 'service', 'free_customer_service', false, 77),
    ]);
    expect(out.daily).toEqual([
      {
        date: '2026-10-01',
        billable: { marketing: 4, service: 0 },
        free: { marketing: 0, service: 0 },
        estimatedCost: 1.4,
      },
      {
        date: '2026-10-02',
        billable: { marketing: 0, service: 0 },
        free: { marketing: 0, service: 77 },
        estimatedCost: 0,
      },
      {
        date: '2026-10-03',
        billable: { marketing: 0, service: 0 },
        free: { marketing: 0, service: 0 },
        estimatedCost: 0,
      },
    ]);
  });

  it('balde fora da lista de dias não some: entra no dia dele, em ordem', () => {
    const out = run([
      row('2026-09-30T15:00:00Z', 'marketing', 'regular', true, 1),
    ]);
    expect(out.daily.map((d) => d.date)).toEqual(['2026-09-30', ...DAYS]);
    expect(out.totals.messages).toBe(1);
  });

  it('categoria vazia vira unknown', () => {
    const out = run([row('2026-10-01T15:00:00Z', '', null, false, 2)]);
    expect(out.totals.byCategory[0]).toMatchObject({
      category: 'unknown',
      type: null,
      count: 2,
    });
    expect(out.daily[0].free).toEqual({ unknown: 2 });
  });

  it('projectedServiceCost = atendimento hoje grátis × tarifa service', () => {
    const out = run([
      row('2026-10-01T15:00:00Z', 'service', 'free_customer_service', false, 77),
      row('2026-10-01T15:00:00Z', 'service', 'regular', true, 3), // já cobrado: fora
      row('2026-10-01T15:00:00Z', 'referral_conversion', 'free_entry_point', false, 50),
    ]);
    expect(out.projectedServiceCost).toBe(7.7);
  });

  it('projectedServiceCost é 0 sem tarifa de service', () => {
    const out = run(
      [row('2026-10-01T15:00:00Z', 'service', 'free_customer_service', false, 77)],
      { rates: { marketing: 0.35 } },
    );
    expect(out.projectedServiceCost).toBe(0);
  });

  it('firstBillableServiceDate sai no dia de São Paulo', () => {
    const out = run([], {
      firstBillableServiceAt: new Date('2026-10-07T01:30:00Z'),
    });
    expect(out.firstBillableServiceDate).toBe('2026-10-06');
  });

  it('não acumula erro de ponto flutuante no custo', () => {
    const out = run([row('2026-10-01T15:00:00Z', 'service', 'regular', true, 3)]);
    expect(out.totals.estimatedCost).toBe(0.3); // 3 × 0,1 = 0,30000000000000004
  });
});
