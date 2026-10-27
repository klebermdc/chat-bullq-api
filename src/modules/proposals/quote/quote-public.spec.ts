import { presentProposal, quoteCode, quoteStatus, toPublicQuote } from './quote-public';

describe('quoteCode', () => {
  it('últimos 6 do id em maiúsculas', () => {
    expect(quoteCode('cm9abcd8k2q1z')).toBe('8K2Q1Z');
  });
});

describe('quoteStatus', () => {
  const now = new Date('2026-10-26T12:00:00.000Z');

  it('ACTIVE antes do vencimento, EXPIRED a partir dele', () => {
    expect(quoteStatus(new Date('2026-10-26T12:00:01.000Z'), now)).toBe('ACTIVE');
    expect(quoteStatus(new Date('2026-10-26T12:00:00.000Z'), now)).toBe('EXPIRED');
    expect(quoteStatus(null, now)).toBe('EXPIRED');
  });
});

describe('toPublicQuote', () => {
  const stored = {
    items: [
      {
        provider: 'Disney',
        title: 'Ingresso',
        startDate: '2026-12-10',
        endDate: '2026-12-10',
        description: null,
        adults: 2,
        children: 0,
        priceAdult: 100,
        priceChild: null,
        total: 200,
        cancellationPolicy: null,
        cpf: '123.456.789-00',
      },
    ],
    currency: 'BRL',
    total: 200,
    pixTotal: null,
    installments: { count: 2, value: 100, extra: 1 },
    notes: null,
    internal: 'x',
  };

  it('devolve só os campos do contrato (lista branca)', () => {
    const out = toPublicQuote(stored)!;

    expect(Object.keys(out).sort()).toEqual(['currency', 'installments', 'items', 'notes', 'pixTotal', 'total']);
    expect(Object.keys(out.items[0]).sort()).toEqual(
      [
        'adults', 'cancellationPolicy', 'children', 'description', 'endDate', 'priceAdult',
        'priceChild', 'provider', 'startDate', 'title', 'total',
      ].sort(),
    );
    expect(out.installments).toEqual({ count: 2, value: 100 });
  });

  it('JSON sem itens devolve null', () => {
    expect(toPublicQuote(null)).toBeNull();
    expect(toPublicQuote({ items: 'x' })).toBeNull();
    expect(toPublicQuote({ items: [] })).toBeNull();
  });
});

describe('presentProposal', () => {
  const env = { QUOTE_PUBLIC_URL: 'https://c.x' };
  const row = {
    id: 'p1',
    kind: 'QUOTE',
    totalValue: 10,
    publicToken: 'tok123',
    expiresAt: new Date('2026-10-27T00:00:00.000Z'),
    viewCount: 2,
    firstViewedAt: null,
    lastViewedAt: null,
  };

  it('QUOTE ganha quoteUrl e os campos de abertura, sem o token cru', () => {
    const out: any = presentProposal(row, env);

    expect(out.quoteUrl).toBe('https://c.x/tok123');
    expect(out.publicToken).toBeUndefined();
    expect(out).toMatchObject({ id: 'p1', viewCount: 2, expiresAt: row.expiresAt, firstViewedAt: null });
  });

  it('outras propostas ficam como eram (sem os campos novos)', () => {
    const out: any = presentProposal(
      { id: 'p2', kind: 'PARKS', publicToken: null, expiresAt: null, viewCount: 0, firstViewedAt: null, lastViewedAt: null },
      env,
    );

    expect(out).toEqual({ id: 'p2', kind: 'PARKS' });
  });

  it('sem env de URL, quoteUrl é null em vez de quebrar a listagem', () => {
    expect((presentProposal(row, {}) as any).quoteUrl).toBeNull();
  });
});
