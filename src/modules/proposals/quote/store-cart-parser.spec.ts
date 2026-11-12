import { parseBrMoney, parseStoreCart, STORE_CART_READY_RE, StoreCartParseError } from './store-cart-parser';
import {
  STORE_CART_TEXT,
  STORE_CONTACT_FORM_TEXT,
  STORE_PAGE_TEXT_HEADLESS,
  STORE_PAGE_TEXT_LOADING,
} from './store-cart.fixture';
import { QUOTE_MAX_ITEMS, QUOTE_PROVIDER_MAX, QUOTE_TITLE_MAX } from './quote.constants';

const UNIVERSAL_TITLE = 'UNIVERSAL ORLANDO INGRESSO 1 OU 2 DIAS BASE TICKET [01 dia]';

/** Monta um item do carrinho no formato da página. */
function itemBlock(over: { header?: string; people?: string[]; date?: string; extra?: string[]; pix?: string; card?: string } = {}) {
  return [
    over.header ?? 'SEAWORLD - SEAWORLD 1 DIA [01 dia]',
    'Pessoas',
    ...(over.people ?? ['2 Adultos']),
    'Data',
    over.date ?? '05/01/2027',
    ...(over.extra ?? []),
    over.pix ?? 'R$ 900,00',
    'PIX ou boleto',
    over.card ?? 'em 10x R$ 950,00',
  ];
}

function cart(items: string[][], totals: string[] = ['Subtotal no pix ou boleto', 'R$ 900,00', 'Subtotal de Ingressos em 10x', 'R$ 950,00']) {
  return ['Detalhes do pedido', 'Ingressos', 'R$ 900,00', ...items.flat(), ...totals].join('\n');
}

describe('parseBrMoney', () => {
  it.each([
    ['R$ 5.888,19', 5888.19],
    ['R$ 1.118,83', 1118.83],
    ['5,78', 5.78],
    ['R$ 300', 300],
    ['R$ 1.234.567,80', 1234567.8],
  ])('lê %s como %d', (input, expected) => {
    expect(parseBrMoney(input)).toBe(expected);
  });

  it.each(['', 'R$', 'abc', 'R$ 1,2,3', 'R$ 12,345'])('devolve null para "%s"', (input) => {
    expect(parseBrMoney(input)).toBeNull();
  });
});

describe('parseStoreCart — carrinho real de 12/11/2026', () => {
  const { quote, storeOffer } = parseStoreCart(STORE_CART_TEXT);

  it('lê os 4 itens, na ordem da página', () => {
    expect(quote.items).toHaveLength(4);
    expect(quote.items.map((i) => i.provider)).toEqual([
      'UNIVERSAL ORLANDO RESORT',
      'UNIVERSAL ORLANDO RESORT',
      'UNIVERSAL ORLANDO RESORT',
      'WALT DISNEY WORLD',
    ]);
  });

  it('fornecedor é o que vem antes do primeiro " - "; o título é o resto, com o [..]', () => {
    expect(quote.items[0].title).toBe(UNIVERSAL_TITLE);
    expect(quote.items[3].title).toBe('BASE TICKETS [02 dias]');
  });

  it('item de um dia: endDate igual a startDate', () => {
    expect(quote.items[0]).toMatchObject({ startDate: '2026-12-20', endDate: '2026-12-20', adults: 1, children: 0 });
  });

  it('Disney: "Pessoas" repetido e "1 Adultos, 0 Crianças" não dobram as pessoas; a janela de uso vira endDate', () => {
    expect(quote.items[3]).toMatchObject({
      startDate: '2026-12-20',
      endDate: '2026-12-23',
      adults: 1,
      children: 0,
      total: 2637.18,
    });
  });

  it('total do item é o valor em 10x (não o do Pix)', () => {
    expect(quote.items.map((i) => i.total)).toEqual([1183.98, 1183.98, 1183.98, 2637.18]);
  });

  it('campos que a loja não mostra ficam null', () => {
    expect(quote.items[0]).toEqual({
      provider: 'UNIVERSAL ORLANDO RESORT',
      title: UNIVERSAL_TITLE,
      startDate: '2026-12-20',
      endDate: '2026-12-20',
      description: null,
      adults: 1,
      children: 0,
      priceAdult: null,
      priceChild: null,
      total: 1183.98,
      cancellationPolicy: null,
      hotelName: null,
      hotel: null,
    });
  });

  it('totais: 10x do subtotal, Pix do subtotal, parcelas lidas do texto', () => {
    expect(quote).toMatchObject({
      currency: 'BRL',
      total: 6189.12,
      pixTotal: 5888.19,
      installments: { count: 10, value: 618.91 },
      notes: null,
    });
  });

  it('a soma dos itens bate com o subtotal em 10x', () => {
    const sum = quote.items.reduce((acc, i) => acc + i.total, 0);
    expect(Math.round(sum * 100) / 100).toBe(quote.total);
  });

  it('storeOffer traz os totais da loja', () => {
    expect(storeOffer).toEqual({ pixTotal: 5888.19, installmentsTotal: 6189.12, installmentsCount: 10 });
  });

  it('ignora o formulário de contato que vem antes de "Detalhes do pedido"', () => {
    const out = parseStoreCart(`${STORE_CONTACT_FORM_TEXT}\n${STORE_CART_TEXT}`);

    expect(out.quote.items).toHaveLength(4);
    expect(out.quote.items[0].adults).toBe(1);
  });

  it('aceita \\r\\n e espaços sobrando nas linhas', () => {
    const messy = STORE_CART_TEXT.split('\n').map((l) => `  ${l}  `).join('\r\n');

    expect(parseStoreCart(messy)).toEqual({ quote, storeOffer });
  });
});

describe('parseStoreCart — página inteira no headless, estado final (12/11/2026)', () => {
  const { quote, storeOffer } = parseStoreCart(STORE_PAGE_TEXT_HEADLESS);
  const reference = parseStoreCart(STORE_CART_TEXT);

  it('lê os 4 itens com espaço não separável e linhas em branco', () => {
    expect(quote.items).toHaveLength(4);
    expect(quote.items.every((i) => i.adults === 1 && i.children === 0)).toBe(true);
  });

  it('dá o mesmo resultado da captura de referência, a menos da ordem dos itens', () => {
    const byTitle = (items: typeof quote.items) => [...items].sort((a, b) => a.title.localeCompare(b.title));

    expect(byTitle(quote.items)).toEqual(byTitle(reference.quote.items));
    expect(quote.total).toBe(reference.quote.total);
    expect(storeOffer).toEqual(reference.storeOffer);
  });
});

describe('parseStoreCart — variações', () => {
  it('lê adultos e crianças em linhas separadas', () => {
    const { quote } = parseStoreCart(cart([itemBlock({ people: ['2 Adultos', '1 Criança'] })]));

    expect(quote.items[0]).toMatchObject({ adults: 2, children: 1 });
  });

  it('lê "N Adultos, N Crianças" sozinho', () => {
    const { quote } = parseStoreCart(cart([itemBlock({ people: ['3 Adultos, 2 Crianças'] })]));

    expect(quote.items[0]).toMatchObject({ adults: 3, children: 2 });
  });

  it('título sem " - " fica inteiro no título, com fornecedor vazio', () => {
    const { quote } = parseStoreCart(cart([itemBlock({ header: 'CHIP EUA 30 DIAS' })]));

    expect(quote.items[0]).toMatchObject({ provider: '', title: 'CHIP EUA 30 DIAS' });
  });

  it('título com mais de um " - " só corta no primeiro', () => {
    const { quote } = parseStoreCart(cart([itemBlock({ header: 'DISNEY - MAGIC KINGDOM - 1 DIA [01 dia]' })]));

    expect(quote.items[0]).toMatchObject({ provider: 'DISNEY', title: 'MAGIC KINGDOM - 1 DIA [01 dia]' });
  });

  it('corta fornecedor e título nos limites da cotação', () => {
    const header = `${'P'.repeat(QUOTE_PROVIDER_MAX + 5)} - ${'T'.repeat(QUOTE_TITLE_MAX + 5)}`;
    const { quote } = parseStoreCart(cart([itemBlock({ header })]));

    expect(quote.items[0].provider).toHaveLength(QUOTE_PROVIDER_MAX);
    expect(quote.items[0].title).toHaveLength(QUOTE_TITLE_MAX);
  });

  it('lê o número de parcelas do texto e calcula a parcela arredondada', () => {
    const totals = ['Subtotal no pix ou boleto', 'R$ 900,00', 'Subtotal de Ingressos em 6x', 'R$ 1.000,00'];
    const { quote, storeOffer } = parseStoreCart(cart([itemBlock({ card: 'em 6x R$ 1.000,00' })], totals));

    expect(quote.installments).toEqual({ count: 6, value: 166.67 });
    expect(storeOffer.installmentsCount).toBe(6);
  });

  it('sem o subtotal em 10x, usa o "em 10x" do Total do pedido', () => {
    const totals = ['Subtotal no pix ou boleto', 'R$ 900,00', 'Total do pedido', 'R$ 900,00', 'em 10x R$ 950,00'];
    const { quote } = parseStoreCart(cart([itemBlock()], totals));

    expect(quote.total).toBe(950);
  });

  it('sem "Subtotal no pix ou boleto", o Pix é a soma do Pix dos itens', () => {
    const totals = ['Subtotal Ingressos', 'R$ 1.900,00', 'Total do pedido', 'R$ 1.800,00', 'em 10x R$ 1.900,00'];
    const items = [itemBlock({ pix: 'R$ 800,00', card: 'em 10x R$ 850,00' }), itemBlock({ pix: 'R$ 1.000,00', card: 'em 10x R$ 1.050,00' })];
    const { storeOffer } = parseStoreCart(cart(items, totals));

    expect(storeOffer).toEqual({ pixTotal: 1800, installmentsTotal: 1900, installmentsCount: 10 });
  });

  it('data inexistente vira null', () => {
    const { quote } = parseStoreCart(cart([itemBlock({ date: '31/02/2027' })]));

    expect(quote.items[0]).toMatchObject({ startDate: null, endDate: null });
  });
});

describe('parseStoreCart — erros', () => {
  it('texto sem "Detalhes do pedido" falha', () => {
    expect(() => parseStoreCart('Página não encontrada')).toThrow(StoreCartParseError);
  });

  it('carrinho sem itens falha', () => {
    expect(() => parseStoreCart(cart([]))).toThrow(/nenhum item/i);
  });

  it('carrinho sem totais falha', () => {
    expect(() => parseStoreCart(cart([itemBlock()], []))).toThrow(/totais/i);
  });

  it('item sem o valor em parcelas falha', () => {
    const block = itemBlock().filter((l) => !l.startsWith('em 10x'));

    expect(() => parseStoreCart(cart([block]))).toThrow(StoreCartParseError);
  });

  it('mais itens que o limite da cotação falha', () => {
    const many = Array.from({ length: QUOTE_MAX_ITEMS + 1 }, () => itemBlock());

    expect(() => parseStoreCart(cart(many))).toThrow(new RegExp(`${QUOTE_MAX_ITEMS} itens`));
  });

  it('pessoas acima do limite falha', () => {
    expect(() => parseStoreCart(cart([itemBlock({ people: ['25 Adultos'] })]))).toThrow(/pessoas/i);
  });

  it('parcelas acima do limite falha', () => {
    const totals = ['Subtotal no pix ou boleto', 'R$ 900,00', 'Subtotal de Ingressos em 12x', 'R$ 950,00'];

    expect(() => parseStoreCart(cart([itemBlock({ card: 'em 12x R$ 950,00' })], totals))).toThrow(/parcelas/i);
  });

  it('valor acima do teto falha', () => {
    const totals = ['Subtotal no pix ou boleto', 'R$ 900,00', 'Subtotal de Ingressos em 10x', 'R$ 99.999.999,00'];

    expect(() => parseStoreCart(cart([itemBlock()], totals))).toThrow(StoreCartParseError);
  });
});

describe('STORE_CART_READY_RE', () => {
  it('casa com o carrinho carregado', () => {
    expect(STORE_CART_READY_RE.test(STORE_CART_TEXT)).toBe(true);
  });

  it('casa com a página inteira no estado final', () => {
    expect(STORE_CART_READY_RE.test(STORE_PAGE_TEXT_HEADLESS)).toBe(true);
  });

  it('não casa com o estado intermediário ("Estamos carregando", sem a janela de uso)', () => {
    expect(STORE_CART_READY_RE.test(STORE_PAGE_TEXT_LOADING)).toBe(false);
  });

  it('não casa com o esqueleto que a página mostra enquanto carrega', () => {
    const skeleton = [
      'Detalhes do pedido',
      'Estamos carregando os dados do carrinho.',
      'Ingressos',
      'Ticket Name - Category Name [02 dias]',
      'Pessoas',
      '1 Adulto',
      'Data',
      '17/07/2024',
      'R$ 0,00',
      'PIX ou boleto',
      'em 10x R$ 500,00',
      'Subtotal Ingressos',
      'R$ 0,00',
      'Total do pedido',
      'R$ 0,00',
      'Meio de pagamento',
      'Boleto',
    ].join('\n');

    expect(STORE_CART_READY_RE.test(skeleton)).toBe(false);
  });
});
