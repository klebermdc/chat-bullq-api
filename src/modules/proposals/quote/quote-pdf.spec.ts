import type { BrowserType } from 'playwright';
import { buildQuotePdfHtml, formatMoney, QuotePdfService } from './quote-pdf';
import { QUOTE_COMPANY } from '../quote-company';
import { QUOTE_TERMS } from '../quote-terms';
import type { PublicQuoteView, QuoteItem } from './quote.types';

const item = (over: Partial<QuoteItem> = {}): QuoteItem => ({
  provider: 'Universal Orlando Resort',
  title: 'Universal 2 Park 3 Days',
  startDate: '2026-12-10',
  endDate: '2026-12-12',
  description: 'Acesso aos dois parques',
  adults: 2,
  children: 1,
  priceAdult: 1500,
  priceChild: 1400,
  total: 4400,
  cancellationPolicy: 'Não reembolsável',
  ...over,
});

const view = (over: Partial<PublicQuoteView> = {}): PublicQuoteView => ({
  status: 'ACTIVE',
  code: '8K2Q1Z',
  customerName: 'Ana Souza',
  seller: { name: 'Mariana Lima', whatsapp: '551151984190' },
  createdAt: '2026-10-26T13:00:00.000Z',
  expiresAt: '2026-10-27T13:00:00.000Z',
  quote: {
    items: [item(), item({ provider: 'Disney', title: 'Magic Kingdom', startDate: '2026-12-08', endDate: '2026-12-08', priceAdult: null, priceChild: null, cancellationPolicy: null, description: null })],
    currency: 'BRL',
    total: 9000,
    pixTotal: 8500,
    installments: { count: 10, value: 900 },
    notes: 'Valores sujeitos a disponibilidade',
  },
  company: QUOTE_COMPANY,
  terms: QUOTE_TERMS,
  ...over,
});

const URL = 'https://cotacao.orlandofastpass.com.br/tok';
const normalize = (s: string) => s.replace(/\s/g, ' ');

describe('formatMoney', () => {
  it('formata em pt-BR com a moeda', () => {
    expect(normalize(formatMoney(1797.16, 'BRL'))).toBe('R$ 1.797,16');
    expect(normalize(formatMoney(10, 'USD'))).toBe('US$ 10,00');
  });
});

describe('buildQuotePdfHtml', () => {
  const html = normalize(buildQuotePdfHtml(view(), URL));

  it('CSP primeiro no head e logo embutido (sem rede)', () => {
    expect(html).toMatch(/<head><meta http-equiv="Content-Security-Policy"/);
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).not.toMatch(/src="https?:/);
  });

  it('cabeçalho: Sua cotação, cliente, código, emissão e validade em horário de Brasília', () => {
    expect(html).toContain('Sua cotação');
    expect(html).toContain('Ana Souza');
    expect(html).toContain('#8K2Q1Z');
    expect(html).toContain('26/10/2026 10:00');
    expect(html).toContain('27/10/2026 10:00');
  });

  it('itens em ordem de data, sem preço por pessoa nem cancelamento por item', () => {
    expect(html.indexOf('Magic Kingdom')).toBeLessThan(html.indexOf('Universal 2 Park 3 Days'));
    expect(html).toContain('10/12/2026 a 12/12/2026');
    expect(html).toContain('08/12/2026');
    expect(html).not.toContain('por adulto');
    expect(html).not.toContain('por criança');
    expect(html).not.toContain('Não reembolsável');
  });

  it('aviso de câmbio e a política geral da Orlando Fast Pass no fim', () => {
    expect(html).toContain('cobrados em dólar');
    expect(html).toContain('Política de Cancelamento e Alterações');
    expect(html).toContain('contato@orlandofastpass.com.br');
    expect(html).toContain('(11) 5194-4192');
    expect(html.indexOf('Para fechar')).toBeLessThan(html.indexOf('Política de Cancelamento'));
    expect(html).not.toMatch(/just ?travel/i);
  });

  it('total, Pix, parcelas e observação', () => {
    expect(html).toContain('R$ 9.000,00');
    expect(html).toContain('R$ 8.500,00 no Pix');
    expect(html).toContain('10x de R$ 900,00');
    expect(html).toContain('Valores sujeitos a disponibilidade');
  });

  it('"Para fechar" com vendedor, WhatsApp e link; rodapé com a empresa', () => {
    expect(html).toContain('Para fechar');
    expect(html).toContain('Mariana Lima');
    expect(html).toContain('+55 11 5198-4190');
    expect(html).toContain(URL);
    expect(html).toContain(QUOTE_COMPANY.cnpj);
    expect(html).toContain(QUOTE_COMPANY.tagline);
    expect(html).toContain('@orlando.fastpass');
    expect(html).toContain(QUOTE_COMPANY.hours);
  });

  it('blocos sem dado somem', () => {
    const bare = normalize(
      buildQuotePdfHtml(
        view({
          customerName: null,
          seller: { name: 'Mariana Lima', whatsapp: null },
          quote: { ...view().quote, pixTotal: null, installments: null, notes: null, items: [item({ priceAdult: null, priceChild: null, cancellationPolicy: null, description: null })] },
        }),
        null,
      ),
    );

    expect(bare).not.toContain('no Pix');
    expect(bare).not.toMatch(/\d+x de/);
    expect(bare).not.toContain('Observação');
    expect(bare).not.toContain('WhatsApp');
  });

  it('escapa tudo o que vem de fora', () => {
    const evil = buildQuotePdfHtml(
      view({ customerName: '<script>x</script>', quote: { ...view().quote, items: [item({ title: '<img src=x onerror=1>' })] } }),
      URL,
    );

    expect(evil).not.toContain('<script>x');
    expect(evil).not.toContain('<img src=x');
    expect(evil).toContain('&lt;script&gt;');
  });
});

describe('QuotePdfService', () => {
  it('renderiza o HTML da cotação pelo gerador compartilhado', async () => {
    const page = {
      route: jest.fn(async () => undefined),
      setContent: jest.fn(async () => undefined),
      pdf: jest.fn(async () => Buffer.from('%PDF')),
    };
    const context = { newPage: jest.fn(async () => page), close: jest.fn(async () => undefined) };
    const browser = { newContext: jest.fn(async () => context), close: jest.fn(async () => undefined) };
    const browserType = { launch: jest.fn(async () => browser) } as unknown as BrowserType;

    const out = await new QuotePdfService(browserType).render(view(), URL);

    expect(out.toString()).toBe('%PDF');
    expect(page.setContent).toHaveBeenCalledWith(expect.stringContaining('Sua cotação'), expect.any(Object));
    expect(browser.newContext).toHaveBeenCalledWith({ javaScriptEnabled: false });
  });
});
