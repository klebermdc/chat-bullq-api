import { mergeQuotes } from './quote-merge';
import type { QuoteData, QuoteItem } from './quote.types';

const item = (total: number, title = 'X'): QuoteItem => ({
  provider: 'P', title, startDate: null, endDate: null, description: null,
  adults: 1, children: 0, priceAdult: null, priceChild: null, total, cancellationPolicy: null,
});
const q = (over: Partial<QuoteData>): QuoteData => ({
  items: [item(100)], currency: 'BRL', total: 100, pixTotal: null, installments: null, notes: null, ...over,
});

describe('mergeQuotes', () => {
  it('um print só volta igual', () => {
    const one = q({ installments: { count: 10, value: 10 } });
    expect(mergeQuotes([one])).toBe(one);
  });

  it('itens na ordem, total = soma em centavos, parcelas para o atendente', () => {
    const out = mergeQuotes([q({ items: [item(0.1, 'A')] }), q({ items: [item(0.2, 'B')], installments: { count: 3, value: 1 } })]);
    expect(out.items.map((i) => i.title)).toEqual(['A', 'B']);
    expect(out.total).toBe(0.3);
    expect(out.installments).toBeNull();
  });

  it('Pix só quando todos os prints têm', () => {
    expect(mergeQuotes([q({ pixTotal: 90 }), q({ pixTotal: 80.5 })]).pixTotal).toBe(170.5);
    expect(mergeQuotes([q({ pixTotal: 90 }), q({ pixTotal: null })]).pixTotal).toBeNull();
  });

  it('não passa de 10 itens', () => {
    const many = q({ items: Array.from({ length: 7 }, () => item(1)) });
    expect(mergeQuotes([many, many]).items).toHaveLength(10);
  });
});
