import { DivergenceService } from './divergence.service';
import { ExtractedCart } from '../proposals/proposals.types';

const svc = new DivergenceService();
const cart = (over: Partial<ExtractedCart> = {}): ExtractedCart => ({
  adults: 4,
  children: 0,
  startDate: '2026-07-10',
  endDate: '2026-07-15',
  parks: [{ nome: 'Magic Kingdom', dias: 1, data: '2026-07-10' }],
  totalValue: 1000,
  currency: 'BRL',
  ...over,
});

describe('DivergenceService.compare', () => {
  it('ITEM_MISMATCH quando quantidade difere', () => {
    const d = svc.compare(
      { items: [{ produto: 'Magic Kingdom', quantidade: 5 }], travelDatesText: null, travelStart: null, travelEnd: null },
      cart(),
    );
    expect(d.map((x) => x.kind)).toContain('ITEM_MISMATCH');
  });

  it('ITEM_MISMATCH quando produto difere', () => {
    const d = svc.compare(
      { items: [{ produto: 'Universal', quantidade: 4 }], travelDatesText: null, travelStart: null, travelEnd: null },
      cart(),
    );
    expect(d.map((x) => x.kind)).toContain('ITEM_MISMATCH');
  });

  it('produto igual com acento/caixa diferente NÃO diverge', () => {
    const d = svc.compare(
      { items: [{ produto: 'MAGIC kingdom', quantidade: 4 }], travelDatesText: null, travelStart: null, travelEnd: null },
      cart(),
    );
    expect(d.filter((x) => x.kind === 'ITEM_MISMATCH')).toHaveLength(0);
  });

  it('TRAVEL_DATE_MISMATCH quando período pedido não bate', () => {
    const d = svc.compare(
      { items: [{ produto: 'Magic Kingdom', quantidade: 4 }], travelDatesText: 'agosto', travelStart: '2026-08-01', travelEnd: '2026-08-05' },
      cart(),
    );
    expect(d.map((x) => x.kind)).toContain('TRAVEL_DATE_MISMATCH');
  });

  it('não alerta data quando a ficha não tem travelStart parseado (texto solto)', () => {
    const d = svc.compare(
      { items: [{ produto: 'Magic Kingdom', quantidade: 4 }], travelDatesText: 'sei lá, mês que vem', travelStart: null, travelEnd: null },
      cart(),
    );
    expect(d.filter((x) => x.kind === 'TRAVEL_DATE_MISMATCH')).toHaveLength(0);
  });

  it('sem divergência quando quantidade+produto+datas batem', () => {
    const d = svc.compare(
      { items: [{ produto: 'Magic Kingdom', quantidade: 4 }], travelDatesText: null, travelStart: '2026-07-10', travelEnd: '2026-07-15' },
      cart(),
    );
    expect(d.filter((x) => x.kind === 'ITEM_MISMATCH' || x.kind === 'TRAVEL_DATE_MISMATCH')).toHaveLength(0);
  });
});
