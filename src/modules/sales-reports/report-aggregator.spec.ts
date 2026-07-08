import { parseOfpDate, aggregate, filterOrders } from './report-aggregator';
import type { OfpOrder } from './ofp-report.service';

const o = (over: Partial<OfpOrder>): OfpOrder =>
  ({
    id: Math.random().toString(), user_id: null, pedido: null, cliente: null,
    email_cliente: null, telefone_cliente: null, vendedor: 'Pedro', venda: 0,
    comissao: null, comissao_total: null, porcentagem_vendedor: null,
    comissao_vendedor: null, fornecedor: null, produto: null, data: null,
    status: null, enviado: null, guia: null, comissao_guia: null,
    created_at: null, updated_at: null, ...over,
  }) as OfpOrder;

describe('parseOfpDate', () => {
  it('parses DD/MM/YYYY to YYYY-MM', () => {
    expect(parseOfpDate('07/07/2026')).toBe('2026-07');
    expect(parseOfpDate('01/12/2025')).toBe('2025-12');
  });
  it('returns null for invalid', () => {
    expect(parseOfpDate('')).toBeNull();
    expect(parseOfpDate('nope')).toBeNull();
    expect(parseOfpDate(null)).toBeNull();
  });
});

describe('aggregate', () => {
  const orders: OfpOrder[] = [
    o({ vendedor: 'Pedro', venda: 100, comissao_vendedor: 10, status: 'Pendente', produto: 'Ingresso', fornecedor: 'JT', data: '07/07/2026' }),
    o({ vendedor: 'Pedro', venda: 50, comissao_vendedor: 5, status: 'Enviado', produto: 'Guiamento', fornecedor: 'JT', data: '10/06/2026' }),
    o({ vendedor: 'Rafael', venda: 200, comissao_vendedor: null, status: 'Pendente', produto: 'Ingresso', fornecedor: 'X', data: '07/07/2026' }),
  ];

  it('computes totals treating null as 0', () => {
    const r = aggregate(orders, { scope: 'all', seller: null });
    expect(r.totals.orders).toBe(3);
    expect(r.totals.venda).toBe(350);
    expect(r.totals.comissaoVendedor).toBe(15);
  });

  it('groups by status', () => {
    const r = aggregate(orders, { scope: 'all', seller: null });
    const pend = r.byStatus.find((s) => s.status === 'Pendente');
    expect(pend?.count).toBe(2);
    expect(pend?.venda).toBe(300);
  });

  it('groups by month using DD/MM/YYYY', () => {
    const r = aggregate(orders, { scope: 'all', seller: null });
    const jul = r.byMonth.find((m) => m.month === '2026-07');
    expect(jul?.count).toBe(2);
    expect(jul?.venda).toBe(300);
  });

  it('builds bySeller only when scope=all', () => {
    const all = aggregate(orders, { scope: 'all', seller: null });
    expect(all.bySeller.find((s) => s.vendedor === 'Pedro')?.orders).toBe(2);
    const seller = aggregate(orders, { scope: 'seller', seller: 'Pedro' });
    expect(seller.bySeller).toEqual([]);
  });

  it('omits raw orders unless includeOrders', () => {
    expect(aggregate(orders, { scope: 'all', seller: null }).orders).toBeUndefined();
    expect(aggregate(orders, { scope: 'all', seller: null, includeOrders: true }).orders?.length).toBe(3);
  });
});

describe('parseOfpDate padding', () => {
  it('accepts non-zero-padded day/month', () => {
    expect(parseOfpDate('7/7/2026')).toBe('2026-07');
    expect(parseOfpDate('1/2/2025')).toBe('2025-02');
  });
});

describe('filterOrders', () => {
  const orders: OfpOrder[] = [
    o({ vendedor: 'Pedro', data: '07/07/2026' }),
    o({ vendedor: 'Rafael', data: '07/07/2026' }),
    o({ vendedor: 'Pedro', data: '10/06/2026' }),
    o({ vendedor: 'Pedro', data: null }),
  ];
  it('filters by vendedor (exact match)', () => {
    expect(filterOrders(orders, { vendedor: 'Pedro' }).length).toBe(3);
  });
  it('filters by month+year, dropping unparseable dates', () => {
    expect(filterOrders(orders, { month: 7, year: 2026 }).length).toBe(2);
    expect(filterOrders(orders, { vendedor: 'Pedro', month: 7, year: 2026 }).length).toBe(1);
  });
  it('no filter returns all', () => {
    expect(filterOrders(orders, {}).length).toBe(4);
  });
});

describe('includeOrders PII projection', () => {
  it('drops email_cliente/telefone_cliente but keeps cliente', () => {
    const withPii = [o({ cliente: 'Ana', email_cliente: 'a@x.com', telefone_cliente: '11999', venda: 10 })];
    const r = aggregate(withPii, { scope: 'seller', seller: 'Pedro', includeOrders: true });
    const row = r.orders![0];
    expect(row.cliente).toBe('Ana');
    expect(row.email_cliente).toBeUndefined();
    expect(row.telefone_cliente).toBeUndefined();
  });
});
