import type { OfpOrder } from './ofp-report.service';

const n = (v: unknown): number => (typeof v === 'number' && !isNaN(v) ? v : 0);
const round2 = (v: number): number => Math.round(v * 100) / 100;

const PUBLIC_ORDER_FIELDS = [
  'id', 'pedido', 'cliente', 'vendedor', 'fornecedor', 'produto',
  'venda', 'comissao_vendedor', 'comissao_total', 'status', 'enviado', 'guia', 'data', 'created_at',
] as const;

function projectOrder(o: OfpOrder): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_ORDER_FIELDS) out[k] = o[k];
  return out;
}

export function parseOfpDate(data: string | null): string | null {
  if (!data) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(data.trim());
  if (!m) return null;
  const [, , mm, yyyy] = m;
  const month = Number(mm);
  if (month < 1 || month > 12) return null;
  return `${yyyy}-${String(month).padStart(2, '0')}`;
}

export function filterOrders(
  orders: OfpOrder[],
  f: { vendedor?: string; month?: number; year?: number },
): OfpOrder[] {
  return orders.filter((o) => {
    if (f.vendedor && o.vendedor !== f.vendedor) return false;
    if (f.month || f.year) {
      const ym = parseOfpDate(o.data);
      if (!ym) return false;
      const [yStr, mStr] = ym.split('-');
      if (f.year && Number(yStr) !== f.year) return false;
      if (f.month && Number(mStr) !== f.month) return false;
    }
    return true;
  });
}

export interface AggregateOpts {
  scope: 'all' | 'seller';
  seller: string | null;
  month?: number;
  year?: number;
  includeOrders?: boolean;
}

export interface SalesReport {
  scope: 'all' | 'seller';
  seller: string | null;
  filters: { month?: number; year?: number };
  totals: {
    orders: number; venda: number; comissaoVendedor: number;
    comissaoTotal: number; comissaoGuia: number;
  };
  byStatus: Array<{ status: string; count: number; venda: number; comissaoVendedor: number }>;
  byMonth: Array<{ month: string; count: number; venda: number; comissaoVendedor: number }>;
  byProduct: Array<{ produto: string; count: number; venda: number }>;
  byFornecedor: Array<{ fornecedor: string; count: number; venda: number }>;
  bySeller: Array<{ vendedor: string; orders: number; venda: number; comissaoVendedor: number }>;
  orders?: Array<Record<string, unknown>>;
}

export function aggregate(orders: OfpOrder[], opts: AggregateOpts): SalesReport {
  const totals = { orders: orders.length, venda: 0, comissaoVendedor: 0, comissaoTotal: 0, comissaoGuia: 0 };
  const byStatus = new Map<string, { count: number; venda: number; comissaoVendedor: number }>();
  const byMonth = new Map<string, { count: number; venda: number; comissaoVendedor: number }>();
  const byProduct = new Map<string, { count: number; venda: number }>();
  const byFornecedor = new Map<string, { count: number; venda: number }>();
  const bySeller = new Map<string, { orders: number; venda: number; comissaoVendedor: number }>();

  for (const ord of orders) {
    const venda = n(ord.venda);
    const comV = n(ord.comissao_vendedor);
    totals.venda += venda;
    totals.comissaoVendedor += comV;
    totals.comissaoTotal += n(ord.comissao_total);
    totals.comissaoGuia += n(ord.comissao_guia);

    const st = ord.status || 'Sem status';
    const s = byStatus.get(st) ?? { count: 0, venda: 0, comissaoVendedor: 0 };
    s.count++; s.venda += venda; s.comissaoVendedor += comV; byStatus.set(st, s);

    const mo = parseOfpDate(ord.data) ?? 'sem-data';
    const mm = byMonth.get(mo) ?? { count: 0, venda: 0, comissaoVendedor: 0 };
    mm.count++; mm.venda += venda; mm.comissaoVendedor += comV; byMonth.set(mo, mm);

    const pr = ord.produto || 'Sem produto';
    const p = byProduct.get(pr) ?? { count: 0, venda: 0 };
    p.count++; p.venda += venda; byProduct.set(pr, p);

    const fo = ord.fornecedor || 'Sem fornecedor';
    const f = byFornecedor.get(fo) ?? { count: 0, venda: 0 };
    f.count++; f.venda += venda; byFornecedor.set(fo, f);

    if (opts.scope === 'all') {
      const ve = ord.vendedor || 'Sem vendedor';
      const v = bySeller.get(ve) ?? { orders: 0, venda: 0, comissaoVendedor: 0 };
      v.orders++; v.venda += venda; v.comissaoVendedor += comV; bySeller.set(ve, v);
    }
  }

  const r2obj = <T extends Record<string, number>>(o: T): T => {
    const out = { ...o };
    for (const k of Object.keys(out)) if (k !== 'count' && k !== 'orders') (out as any)[k] = round2((out as any)[k]);
    return out;
  };

  return {
    scope: opts.scope,
    seller: opts.seller,
    filters: { month: opts.month, year: opts.year },
    totals: {
      orders: totals.orders,
      venda: round2(totals.venda),
      comissaoVendedor: round2(totals.comissaoVendedor),
      comissaoTotal: round2(totals.comissaoTotal),
      comissaoGuia: round2(totals.comissaoGuia),
    },
    byStatus: [...byStatus.entries()].map(([status, v]) => ({ status, ...r2obj(v) })).sort((a, b) => b.venda - a.venda),
    byMonth: [...byMonth.entries()].map(([month, v]) => ({ month, ...r2obj(v) })).sort((a, b) => a.month.localeCompare(b.month)),
    byProduct: [...byProduct.entries()].map(([produto, v]) => ({ produto, ...r2obj(v) })).sort((a, b) => b.venda - a.venda),
    byFornecedor: [...byFornecedor.entries()].map(([fornecedor, v]) => ({ fornecedor, ...r2obj(v) })).sort((a, b) => b.venda - a.venda),
    bySeller: [...bySeller.entries()].map(([vendedor, v]) => ({ vendedor, ...r2obj(v) })).sort((a, b) => b.venda - a.venda),
    orders: opts.includeOrders ? orders.map(projectOrder) : undefined,
  };
}
