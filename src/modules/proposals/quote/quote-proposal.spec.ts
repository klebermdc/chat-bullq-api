import { BadRequestException } from '@nestjs/common';
import {
  buildQuoteMessage,
  contactDisplayName,
  firstName,
  newQuoteToken,
  normalizeQuote,
  quoteCart,
  quoteExpiresAt,
  quotePublicUrl,
} from './quote-proposal';
import { QUOTE_TOKEN_RE } from './quote.constants';
import type { QuoteData, QuoteItem } from './quote.types';

const item = (over: Partial<QuoteItem> = {}): QuoteItem => ({
  provider: 'Universal Orlando Resort',
  title: 'Ingresso 2 parques',
  startDate: '2026-12-10',
  endDate: '2026-12-12',
  description: null,
  adults: 2,
  children: 1,
  priceAdult: null,
  priceChild: null,
  total: 5000,
  cancellationPolicy: null, hotelName: null, hotel: null,
  ...over,
});
const quote = (over: Partial<QuoteData> = {}): QuoteData => ({
  items: [item()],
  currency: 'BRL',
  total: 5000,
  pixTotal: null,
  installments: null,
  notes: null,
  ...over,
});

describe('newQuoteToken', () => {
  it('gera 32 caracteres base64url que passam no regex público e não repetem', () => {
    const a = newQuoteToken();
    const b = newQuoteToken();

    expect(a).toHaveLength(32);
    expect(a).toMatch(QUOTE_TOKEN_RE);
    expect(a).not.toBe(b);
  });
});

describe('quoteExpiresAt', () => {
  const now = new Date('2026-10-26T12:00:00.000Z');

  it('padrão de 24h', () => {
    expect(quoteExpiresAt(now).toISOString()).toBe('2026-10-27T12:00:00.000Z');
  });

  it('usa as horas pedidas (168h = 7 dias)', () => {
    expect(quoteExpiresAt(now, 168).toISOString()).toBe('2026-11-02T12:00:00.000Z');
  });
});

describe('quotePublicUrl', () => {
  it('usa QUOTE_PUBLIC_URL sem barra no fim', () => {
    expect(quotePublicUrl('tok', { QUOTE_PUBLIC_URL: 'https://cotacao.orlandofastpass.com.br/' })).toBe(
      'https://cotacao.orlandofastpass.com.br/tok',
    );
  });

  it('cai para APP_PUBLIC_URL/cotacao', () => {
    expect(quotePublicUrl('tok', { APP_PUBLIC_URL: 'https://sendtur.com.br//' })).toBe(
      'https://sendtur.com.br/cotacao/tok',
    );
  });

  it('sem nenhuma das duas devolve null', () => {
    expect(quotePublicUrl('tok', { QUOTE_PUBLIC_URL: '  ' })).toBeNull();
  });
});

describe('firstName / buildQuoteMessage', () => {
  const url = 'https://c.x/tok';

  it('primeiro nome aparado', () => {
    expect(firstName('  Ana Maria Souza ')).toBe('Ana');
    expect(firstName('   ')).toBeNull();
    expect(firstName(null)).toBeNull();
  });

  it('mensagem exata com nome', () => {
    expect(buildQuoteMessage('Ana Souza', url)).toBe(
      'Oi, Ana! Sua cotação ficou pronta. Toque no link para ver tudo com calma, e qualquer dúvida é só me chamar aqui.\n\nhttps://c.x/tok',
    );
  });

  it('mensagem exata sem nome', () => {
    expect(buildQuoteMessage(null, url)).toBe(
      'Oi! Sua cotação ficou pronta. Toque no link para ver tudo com calma, e qualquer dúvida é só me chamar aqui.\n\nhttps://c.x/tok',
    );
  });
});

describe('contactDisplayName', () => {
  it('nome do contato aparado e cortado em 60', () => {
    expect(contactDisplayName('  Ana Souza ')).toBe('Ana Souza');
    expect(contactDisplayName('A'.repeat(70))).toHaveLength(60);
  });

  it('vazio ou só telefone vira null', () => {
    expect(contactDisplayName(null)).toBeNull();
    expect(contactDisplayName('  ')).toBeNull();
    expect(contactDisplayName('+55 11 99999-0000')).toBeNull();
  });
});

describe('normalizeQuote', () => {
  it('preenche ausentes com null, apara textos e não muda a entrada', () => {
    const input: any = {
      items: [{ provider: ' Alamo ', title: ' Carro ', adults: 2, children: 0, total: 100 }],
      currency: 'BRL',
      total: 100,
    };
    const frozen = JSON.stringify(input);

    const out = normalizeQuote(input);

    expect(out).toEqual({
      items: [
        {
          provider: 'Alamo',
          title: 'Carro',
          startDate: null,
          endDate: null,
          description: null,
          adults: 2,
          children: 0,
          priceAdult: null,
          priceChild: null,
          total: 100,
          cancellationPolicy: null,
          hotelName: null,
          hotel: null,
        },
      ],
      currency: 'BRL',
      total: 100,
      pixTotal: null,
      installments: null,
      notes: null,
    });
    expect(JSON.stringify(input)).toBe(frozen);
  });

  it('texto só de espaços vira null', () => {
    const out = normalizeQuote({ ...quote(), notes: '   ', items: [item({ description: ' ' })] });

    expect(out.notes).toBeNull();
    expect(out.items[0].description).toBeNull();
  });

  it('só data final vira as duas iguais; só inicial também', () => {
    const out = normalizeQuote(
      quote({ items: [item({ startDate: null, endDate: '2026-12-12' }), item({ endDate: null })] }),
    );

    expect(out.items[0]).toMatchObject({ startDate: '2026-12-12', endDate: '2026-12-12' });
    expect(out.items[1]).toMatchObject({ startDate: '2026-12-10', endDate: '2026-12-10' });
  });

  it('data final antes da inicial é 400', () => {
    expect(() => normalizeQuote(quote({ items: [item({ startDate: '2026-12-12', endDate: '2026-12-10' })] }))).toThrow(
      BadRequestException,
    );
  });

  it('título só de espaços é 400', () => {
    expect(() => normalizeQuote(quote({ items: [item({ title: '   ' })] }))).toThrow(BadRequestException);
  });
});

describe('quoteCart', () => {
  const now = new Date('2026-10-26T12:00:00.000Z');

  it('pessoas = máximo dos itens; datas = menor e maior; sem parques', () => {
    const cart = quoteCart(
      quote({
        total: 9000,
        currency: 'USD',
        items: [
          item({ adults: 2, children: 3, startDate: '2026-12-10', endDate: '2026-12-12' }),
          item({ adults: 4, children: 0, startDate: '2026-12-05', endDate: '2026-12-20' }),
          item({ startDate: null, endDate: null }),
        ],
      }),
      now,
    );

    expect(cart).toEqual({
      adults: 4,
      children: 3,
      startDate: '2026-12-05',
      endDate: '2026-12-20',
      parks: [],
      totalValue: 9000,
      currency: 'USD',
    });
  });

  it('sem nenhuma data usa o momento do envio', () => {
    const cart = quoteCart(quote({ items: [item({ startDate: null, endDate: null })] }), now);

    expect(cart.startDate).toBe(now.toISOString());
    expect(cart.endDate).toBe(now.toISOString());
  });
});
