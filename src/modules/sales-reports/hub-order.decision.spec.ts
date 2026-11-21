import { decideOrderWon, HubCard, HubOrderFacts, pickLookupCard, wonCandidates } from './hub-order.decision';

const DAY = 24 * 60 * 60 * 1000;
const ORDER_DATE = new Date('2026-11-18T12:00:00Z');

function card(over: Partial<HubCard> = {}): HubCard {
  return {
    id: 'c1',
    status: 'OPEN',
    value: null,
    closedAt: null,
    updatedAt: new Date('2026-11-10T00:00:00Z'),
    orderNumber: null,
    ofpOrderExternalId: null,
    sellerName: null,
    ...over,
  };
}

const order: HubOrderFacts = { pedido: '4853LD', venda: 21369.49, vendedor: 'Renata', data: ORDER_DATE };
const wonAt = (days: number) => new Date(ORDER_DATE.getTime() + days * DAY);

describe('wonCandidates', () => {
  it('inclui OPEN e Ganho em ±7 dias sem pedido ligado', () => {
    const cards = [
      card({ id: 'open' }),
      card({ id: 'won-ok', status: 'WON', closedAt: wonAt(-6) }),
      card({ id: 'won-old', status: 'WON', closedAt: wonAt(-8) }),
      card({ id: 'won-linked', status: 'WON', closedAt: wonAt(0), ofpOrderExternalId: 'x' }),
      card({ id: 'open-linked', ofpOrderExternalId: 'y' }),
      card({ id: 'lost', status: 'LOST', closedAt: wonAt(0) }),
    ];
    expect(wonCandidates(cards, ORDER_DATE).map((c) => c.id)).toEqual(['open', 'won-ok']);
  });
});

describe('decideOrderWon', () => {
  it('sem candidatos → no_card', () => {
    expect(decideOrderWon([], order)).toEqual({ result: 'no_card', candidates: 0 });
  });

  it('um OPEN e nenhum Ganho recente → won', () => {
    const res = decideOrderWon([card({ id: 'open' })], order);
    expect(res).toMatchObject({ result: 'won', candidates: 1, card: { id: 'open' } });
  });

  it('nenhum OPEN e um Ganho recente sem pedido → linked_existing', () => {
    const res = decideOrderWon([card({ id: 'w', status: 'WON', closedAt: wonAt(2) })], order);
    expect(res).toMatchObject({ result: 'linked_existing', card: { id: 'w' } });
  });

  it('dois OPEN sem sinal que desempate → ambiguous', () => {
    const res = decideOrderWon([card({ id: 'a' }), card({ id: 'b' })], order);
    expect(res).toEqual({ result: 'ambiguous', candidates: 2 });
  });

  it('OPEN + Ganho recente sem sinal → ambiguous', () => {
    const res = decideOrderWon([card({ id: 'a' }), card({ id: 'w', status: 'WON', closedAt: wonAt(1) })], order);
    expect(res).toEqual({ result: 'ambiguous', candidates: 2 });
  });

  it('desempata pelo nº do pedido digitado no card (texto livre)', () => {
    const res = decideOrderWon(
      [card({ id: 'a' }), card({ id: 'w', status: 'WON', closedAt: wonAt(1), orderNumber: 'Localizador: 4853ld' })],
      order,
    );
    expect(res).toMatchObject({ result: 'linked_existing', card: { id: 'w' }, candidates: 2 });
  });

  it('desempata pelo valor', () => {
    const res = decideOrderWon([card({ id: 'a', value: 100 }), card({ id: 'b', value: 21369.49 })], order);
    expect(res).toMatchObject({ result: 'won', card: { id: 'b' } });
  });

  it('desempata pelo vendedor quando o valor não decide', () => {
    const res = decideOrderWon(
      [card({ id: 'a', sellerName: 'Maria Gabriela' }), card({ id: 'b', sellerName: 'Renata Souza' })],
      order,
    );
    expect(res).toMatchObject({ result: 'won', card: { id: 'b' } });
  });

  it('sinal que casa com mais de um não decide sozinho; o próximo desempata', () => {
    const res = decideOrderWon(
      [
        card({ id: 'a', value: 21369.49, sellerName: 'Maria' }),
        card({ id: 'b', value: 21369.49, sellerName: 'Renata' }),
        card({ id: 'c', value: 5 }),
      ],
      order,
    );
    expect(res).toMatchObject({ result: 'won', card: { id: 'b' }, candidates: 3 });
  });

  it('empate em todos os sinais → ambiguous', () => {
    const res = decideOrderWon(
      [card({ id: 'a', sellerName: 'Renata' }), card({ id: 'b', sellerName: 'Renata' })],
      order,
    );
    expect(res).toEqual({ result: 'ambiguous', candidates: 2 });
  });
});

describe('pickLookupCard', () => {
  const now = new Date('2026-11-21T12:00:00Z');

  it('prefere o OPEN mais recente', () => {
    const res = pickLookupCard(
      [
        card({ id: 'old', updatedAt: new Date('2026-11-01') }),
        card({ id: 'new', updatedAt: new Date('2026-11-20') }),
        card({ id: 'w', status: 'WON', closedAt: new Date('2026-11-21') }),
      ],
      now,
    );
    expect(res?.id).toBe('new');
  });

  it('sem OPEN: Ganho mais recente dos últimos 45 dias sem pedido ligado', () => {
    const res = pickLookupCard(
      [
        card({ id: 'linked', status: 'WON', closedAt: new Date('2026-11-20'), ofpOrderExternalId: 'x' }),
        card({ id: 'w1', status: 'WON', closedAt: new Date('2026-11-01') }),
        card({ id: 'w2', status: 'WON', closedAt: new Date('2026-11-15') }),
        card({ id: 'too-old', status: 'WON', closedAt: new Date('2026-09-01') }),
      ],
      now,
    );
    expect(res?.id).toBe('w2');
  });

  it('nada serve → null', () => {
    expect(pickLookupCard([card({ status: 'LOST' })], now)).toBeNull();
  });
});
