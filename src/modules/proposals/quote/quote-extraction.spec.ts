import { parseQuoteFromModel, QUOTE_SYSTEM_PROMPT, scrubPersonalData } from './quote-extraction';

const modelItem = (over: Record<string, unknown> = {}) => ({
  provider: 'Universal Orlando Resort',
  title: 'Universal 2 Park 3 Days',
  startDate: '2026-12-10',
  endDate: '2026-12-12',
  description: 'Acesso aos dois parques',
  adults: 2,
  children: 1,
  priceAdult: null,
  priceChild: null,
  total: 9000,
  cancellationPolicy: 'Não reembolsável',
  ...over,
});
const modelQuote = (over: Record<string, unknown> = {}) => ({
  items: [modelItem()],
  currency: 'BRL',
  total: 9000,
  pixTotal: 8500,
  installments: { count: 10, value: 900 },
  ...over,
});

describe('QUOTE_SYSTEM_PROMPT', () => {
  it('manda ignorar CPF e nomes, copiar valores e não inventar preço por pessoa', () => {
    expect(QUOTE_SYSTEM_PROMPT).toMatch(/CPF/);
    expect(QUOTE_SYSTEM_PROMPT).toMatch(/NOMES/);
    expect(QUOTE_SYSTEM_PROMPT).toMatch(/EXATAMENTE/);
    expect(QUOTE_SYSTEM_PROMPT).toMatch(/NUNCA calcule/);
    expect(QUOTE_SYSTEM_PROMPT).toMatch(/UNREADABLE/);
  });
});

describe('parseQuoteFromModel', () => {
  it('lê a cotação completa no formato do contrato (notas sempre nulas)', () => {
    expect(parseQuoteFromModel(modelQuote())).toEqual({
      items: [{ ...modelItem() }],
      currency: 'BRL',
      total: 9000,
      pixTotal: 8500,
      installments: { count: 10, value: 900 },
      notes: null,
    });
  });

  it('UNREADABLE ou sem itens é erro (vira nova tentativa)', () => {
    expect(() => parseQuoteFromModel({ kind: 'UNREADABLE' })).toThrow(/ler/);
    expect(() => parseQuoteFromModel(modelQuote({ items: [] }))).toThrow(/ler/);
    expect(() => parseQuoteFromModel(null)).toThrow(/ler/);
  });

  it('item sem título é descartado; nenhum item válido é erro', () => {
    const out = parseQuoteFromModel(modelQuote({ items: [modelItem({ title: '' }), modelItem()] }));
    expect(out.items).toHaveLength(1);

    expect(() => parseQuoteFromModel(modelQuote({ items: [modelItem({ title: ' ' })] }))).toThrow();
  });

  it('preço por pessoa ausente, zero ou texto fica null (nada inventado)', () => {
    const out = parseQuoteFromModel(
      modelQuote({ items: [modelItem({ priceAdult: 0, priceChild: '100' })] }),
    );

    expect(out.items[0].priceAdult).toBeNull();
    expect(out.items[0].priceChild).toBeNull();
  });

  it('datas inválidas viram null; só uma data vale para as duas', () => {
    const out = parseQuoteFromModel(
      modelQuote({
        items: [
          modelItem({ startDate: '10/12/2026', endDate: null }),
          modelItem({ startDate: '2026-12-10', endDate: null }),
        ],
      }),
    );

    expect(out.items[0]).toMatchObject({ startDate: null, endDate: null });
    expect(out.items[1]).toMatchObject({ startDate: '2026-12-10', endDate: '2026-12-10' });
  });

  it('pessoas fora de 0..20 ou não inteiras ficam no limite', () => {
    const out = parseQuoteFromModel(modelQuote({ items: [modelItem({ adults: 40, children: -2 })] }));

    expect(out.items[0]).toMatchObject({ adults: 20, children: 0 });
  });

  it('total da reserva ausente: soma dos itens; item sem total com um item só: total da reserva', () => {
    const summed = parseQuoteFromModel(
      modelQuote({ total: null, items: [modelItem({ total: 100 }), modelItem({ total: 50.5 })] }),
    );
    expect(summed.total).toBe(150.5);

    const single = parseQuoteFromModel(modelQuote({ total: 700, items: [modelItem({ total: null })] }));
    expect(single.items[0].total).toBe(700);
  });

  it('sem total nenhum é erro', () => {
    expect(() => parseQuoteFromModel(modelQuote({ total: 0, items: [modelItem({ total: 0 })] }))).toThrow();
  });

  it('moeda inválida vira BRL; parcelas incompletas viram null; Pix zero vira null', () => {
    const out = parseQuoteFromModel(
      modelQuote({ currency: 'reais', installments: { count: 10 }, pixTotal: 0 }),
    );

    expect(out.currency).toBe('BRL');
    expect(out.installments).toBeNull();
    expect(out.pixTotal).toBeNull();
  });

  it('textos longos são cortados no limite do contrato', () => {
    const out = parseQuoteFromModel(
      modelQuote({ items: [modelItem({ provider: 'p'.repeat(100), title: 't'.repeat(300), description: 'd'.repeat(700) })] }),
    );

    expect(out.items[0].provider).toHaveLength(80);
    expect(out.items[0].title).toHaveLength(200);
    expect(out.items[0].description).toHaveLength(600);
  });

  it('mais de 10 itens: fica com os 10 primeiros', () => {
    const out = parseQuoteFromModel(modelQuote({ items: Array.from({ length: 12 }, () => modelItem()) }));

    expect(out.items).toHaveLength(10);
  });

  it('CPF que escapar para um texto é removido', () => {
    const out = parseQuoteFromModel(
      modelQuote({ items: [modelItem({ description: 'Titular CPF 123.456.789-00 confirmado' })] }),
    );

    expect(out.items[0].description).not.toMatch(/123/);
  });
});

describe('scrubPersonalData', () => {
  it('remove CPF com e sem pontuação', () => {
    expect(scrubPersonalData('CPF: 123.456.789-09 e 98765432100')).toBe('CPF: [removido] e [removido]');
  });
});
