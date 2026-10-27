import { BadRequestException } from '@nestjs/common';
import { ProposalsService } from './proposals.service';
import { ConversationAccessService } from '../messaging/conversations/conversation-access.service';
import { PROPOSAL_NEW_FOLLOWUPS_OTHER } from './proposal-followups';
import { QUOTE_TOKEN_RE } from './quote/quote.constants';
import type { QuoteData } from './quote/quote.types';

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('print'),
]);

const quote: QuoteData = {
  items: [
    {
      provider: 'Universal Orlando Resort',
      title: 'Universal 2 Park 3 Days',
      startDate: '2026-12-10',
      endDate: '2026-12-12',
      description: null,
      adults: 2,
      children: 1,
      priceAdult: null,
      priceChild: null,
      total: 9000,
      cancellationPolicy: null,
    },
  ],
  currency: 'BRL',
  total: 9000,
  pixTotal: 8500,
  installments: { count: 10, value: 900 },
  notes: null,
};

const image = { url: 'https://api.x/api/v1/uploads/media/2026-10-26/1.png', mimeType: 'image/png' };
const NOW = new Date('2026-10-26T12:00:00.000Z');

function deps() {
  const conversation = { id: 'conv-1', organizationId: 'org-1', contactId: 'contact-1', channelId: 'chan-1' };
  return {
    prisma: {
      conversation: { findUnique: jest.fn().mockResolvedValue(conversation) },
      contact: { findUnique: jest.fn().mockResolvedValue({ name: 'Ana Souza' }) },
    } as any,
    render: { render: jest.fn().mockResolvedValue('TEXTO RENDER') } as any,
    extraction: {
      extract: jest.fn(),
      extractFromImages: jest.fn(),
      extractQuoteFromImages: jest.fn().mockResolvedValue(quote),
      validateReviewed: jest.fn(),
    } as any,
    repo: {
      create: jest.fn(async (input: any) => ({
        id: 'cm9prop8k2q1z',
        kind: input.kind,
        totalValue: input.cart.totalValue,
        publicToken: input.publicToken ?? null,
        expiresAt: input.expiresAt ?? null,
        viewCount: 0,
        firstViewedAt: null,
        lastViewedAt: null,
      })),
      listForContact: jest.fn(),
    } as any,
    messages: { send: jest.fn().mockResolvedValue({ id: 'msg-1' }) } as any,
    pipelines: { ensureConversationAtStageByName: jest.fn().mockResolvedValue(undefined) } as any,
    orderFicha: { crossCheckOnProposal: jest.fn().mockResolvedValue(undefined) } as any,
    conversationAccess: new ConversationAccessService({
      conversation: { findFirst: jest.fn().mockResolvedValue({ id: 'conv-1' }) },
    } as any),
    storage: {
      stat: jest.fn().mockResolvedValue({ size: PNG_BYTES.byteLength }),
      getBuffer: jest.fn().mockResolvedValue(PNG_BYTES),
    } as any,
  };
}

const makeService = (d: ReturnType<typeof deps>) =>
  new ProposalsService(
    d.prisma, d.render, d.extraction, d.repo, d.messages, d.pipelines, d.orderFicha, d.conversationAccess, d.storage,
  );

const linkBody = (over: Record<string, unknown> = {}): any => ({
  conversationId: 'conv-1',
  checkoutUrl: '',
  includeLink: false,
  format: 'LINK',
  images: [image],
  ...over,
});

describe('ProposalsService — cotação por link', () => {
  const env = { ...process.env };

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    process.env.QUOTE_PUBLIC_URL = 'https://cotacao.orlandofastpass.com.br';
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...env };
  });

  async function rejection(body: any, d = deps()) {
    const err = await makeService(d).create(body, 'user-1', 'org-1', 'ALL' as any).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    return { err: err as BadRequestException, d };
  }

  describe('validação', () => {
    it('LINK sem prints é 400 e não chama modelo nem envia', async () => {
      const { err, d } = await rejection(linkBody({ images: [] }));

      expect(err.message).toMatch(/print/i);
      expect(d.extraction.extractQuoteFromImages).not.toHaveBeenCalled();
      expect(d.messages.send).not.toHaveBeenCalled();
    });

    it('LINK sem includeLink:false é 400', async () => {
      const { err } = await rejection(linkBody({ includeLink: undefined, quote }));

      expect(err.message).toMatch(/sem o link do checkout/);
    });

    it('envio sem quote é 400 e nada é gravado nem enviado', async () => {
      const { err, d } = await rejection(linkBody());

      expect(err.message).toMatch(/Confira a cotação/);
      expect(d.repo.create).not.toHaveBeenCalled();
      expect(d.messages.send).not.toHaveBeenCalled();
    });

    it('sem QUOTE_PUBLIC_URL nem APP_PUBLIC_URL é 400 antes de gravar', async () => {
      delete process.env.QUOTE_PUBLIC_URL;
      delete process.env.APP_PUBLIC_URL;

      const { err, d } = await rejection(linkBody({ quote }));

      expect(err.message).toMatch(/QUOTE_PUBLIC_URL/);
      expect(d.repo.create).not.toHaveBeenCalled();
    });

    it('datas invertidas na cotação conferida são 400', async () => {
      const bad = { ...quote, items: [{ ...quote.items[0], startDate: '2026-12-12', endDate: '2026-12-10' }] };

      const { d } = await rejection(linkBody({ quote: bad }));

      expect(d.repo.create).not.toHaveBeenCalled();
    });

    it('print que não é nosso upload é 400', async () => {
      await rejection(linkBody({ quote, images: [{ url: 'https://evil.x/a.png', mimeType: 'image/png' }] }));
    });
  });

  describe('preview', () => {
    it('lê os prints com o prompt de cotação e devolve quote + nome do contato, sem gravar nem enviar', async () => {
      const d = deps();

      const out = await makeService(d).create(linkBody({ preview: true, checkoutUrl: 'obs' }), 'user-1', 'org-1', 'ALL' as any);

      expect(out).toEqual({ preview: true, quote, customerName: 'Ana Souza', unreadPrints: [] });
      expect(d.extraction.extractQuoteFromImages).toHaveBeenCalledWith('org-1', {
        images: [{ mediaType: 'image/png', data: PNG_BYTES.toString('base64') }],
        pastedText: 'obs',
      });
      expect(d.extraction.extractFromImages).not.toHaveBeenCalled();
      expect(d.repo.create).not.toHaveBeenCalled();
      expect(d.messages.send).not.toHaveBeenCalled();
      expect(d.pipelines.ensureConversationAtStageByName).not.toHaveBeenCalled();
    });

    it('vários prints: um por chamada, juntos na cotação; o que falhar volta em unreadPrints', async () => {
      const d = deps();
      d.extraction.extractQuoteFromImages
        .mockResolvedValueOnce({ ...quote, items: [{ ...quote.items[0], title: 'A', total: 100 }], pixTotal: null })
        .mockRejectedValueOnce(new Error('ilegível'))
        .mockResolvedValueOnce({ ...quote, items: [{ ...quote.items[0], title: 'C', total: 50.5 }], pixTotal: null });

      const out: any = await makeService(d).create(linkBody({ preview: true, images: [image, image, image] }), 'user-1', 'org-1', 'ALL' as any);

      expect(d.extraction.extractQuoteFromImages).toHaveBeenCalledTimes(3);
      expect(out.quote.items.map((i: any) => i.title)).toEqual(['A', 'C']);
      expect(out.quote.total).toBe(150.5);
      expect(out.unreadPrints).toEqual([2]);
    });

    it('contato sem nome (ou com telefone no nome) dá customerName null', async () => {
      const d = deps();
      d.prisma.contact.findUnique.mockResolvedValue({ name: '5511999990000' });

      const out: any = await makeService(d).create(linkBody({ preview: true }), 'user-1', 'org-1', 'ALL' as any);

      expect(out.customerName).toBeNull();
    });

    it('print ilegível é o mesmo 400 de hoje', async () => {
      const d = deps();
      d.extraction.extractQuoteFromImages.mockRejectedValue(new Error('Não foi possível ler a cotação'));

      const { err } = await rejection(linkBody({ preview: true }), d);

      expect(err.message).toMatch(/Não consegui montar a proposta/);
    });
  });

  describe('envio', () => {
    it('grava QUOTE com token, validade, carrinho e details; manda só a mensagem com o link', async () => {
      const d = deps();

      const out: any = await makeService(d).create(
        linkBody({ quote, customerName: '  Ana Souza ', validityHours: 48 }),
        'user-1', 'org-1', 'ALL' as any,
      );

      const input = d.repo.create.mock.calls[0][0];
      expect(input).toMatchObject({
        organizationId: 'org-1',
        contactId: 'contact-1',
        conversationId: 'conv-1',
        checkoutUrl: '',
        createdById: 'user-1',
        kind: 'QUOTE',
        cart: {
          adults: 2, children: 1, startDate: '2026-12-10', endDate: '2026-12-12',
          parks: [], totalValue: 9000, currency: 'BRL',
        },
        details: { images: [{ url: image.url, mimeType: 'image/png' }], quote, customerName: 'Ana Souza' },
      });
      expect(input.publicToken).toMatch(QUOTE_TOKEN_RE);
      expect(input.expiresAt.toISOString()).toBe('2026-10-28T12:00:00.000Z');

      const url = `https://cotacao.orlandofastpass.com.br/${input.publicToken}`;
      const sent = d.messages.send.mock.calls.map((c: any[]) => c[0]);
      expect(sent[0]).toEqual({
        conversationId: 'conv-1',
        type: 'TEXT',
        content: {
          text:
            'Oi, Ana! Sua cotação ficou pronta. Toque no link para ver tudo com calma, e qualquer dúvida é só me chamar aqui.\n\n' +
            url,
        },
      });
      expect(sent.some((m: any) => m.type === 'IMAGE')).toBe(false);
      expect(out.quoteUrl).toBe(url);
      expect(out.publicToken).toBeUndefined();
      expect(out.kind).toBe('QUOTE');
    });

    it('validade padrão de 24h e mensagem sem nome', async () => {
      const d = deps();

      await makeService(d).create(linkBody({ quote, customerName: '   ' }), 'user-1', 'org-1', 'ALL' as any);

      const input = d.repo.create.mock.calls[0][0];
      expect(input.expiresAt.toISOString()).toBe('2026-10-27T12:00:00.000Z');
      expect(input.details.customerName).toBeNull();
      expect(d.messages.send.mock.calls[0][0].content.text).toMatch(/^Oi! Sua cotação ficou pronta\./);
    });

    it('sem QUOTE_PUBLIC_URL usa APP_PUBLIC_URL/cotacao', async () => {
      delete process.env.QUOTE_PUBLIC_URL;
      process.env.APP_PUBLIC_URL = 'https://sendtur.com.br/';
      const d = deps();

      const out: any = await makeService(d).create(linkBody({ quote }), 'user-1', 'org-1', 'ALL' as any);

      expect(out.quoteUrl).toMatch(/^https:\/\/sendtur\.com\.br\/cotacao\/[A-Za-z0-9_-]{32}$/);
    });

    it('NEW: follow-ups de proposta não-ingresso e funil PROPOSTA ENVIADA com o total; sem cruzamento da ficha', async () => {
      const d = deps();

      await makeService(d).create(linkBody({ quote }), 'user-1', 'org-1', 'ALL' as any);

      const texts = d.messages.send.mock.calls.map((c: any[]) => c[0].content.text);
      expect(texts.slice(1)).toEqual(PROPOSAL_NEW_FOLLOWUPS_OTHER);
      expect(d.pipelines.ensureConversationAtStageByName).toHaveBeenCalledWith(
        'org-1', 'conv-1', 'PROPOSTA ENVIADA', { value: 9000, currency: 'BRL' },
      );
      expect(d.orderFicha.crossCheckOnProposal).not.toHaveBeenCalled();
    });

    it('UPDATE não manda follow-ups', async () => {
      const d = deps();

      await makeService(d).create(linkBody({ quote, mode: 'UPDATE' }), 'user-1', 'org-1', 'ALL' as any);

      expect(d.messages.send).toHaveBeenCalledTimes(1);
    });

    it('falha no funil não derruba o envio', async () => {
      const d = deps();
      d.pipelines.ensureConversationAtStageByName.mockRejectedValue(new Error('boom'));

      const out: any = await makeService(d).create(linkBody({ quote }), 'user-1', 'org-1', 'ALL' as any);

      expect(out.quoteUrl).toBeTruthy();
    });

    it('falha num follow-up não derruba o envio', async () => {
      const d = deps();
      d.messages.send.mockResolvedValueOnce({ id: 'm1' }).mockRejectedValueOnce(new Error('fora'));

      const out: any = await makeService(d).create(linkBody({ quote }), 'user-1', 'org-1', 'ALL' as any);

      expect(out.quoteUrl).toBeTruthy();
    });
  });

  describe('modo TEXT explícito', () => {
    it('format TEXT segue o caminho de sempre (abre o checkout)', async () => {
      const d = deps();
      d.extraction.extract.mockResolvedValue({
        adults: 1, children: 0, startDate: '2026-10-02', endDate: '2026-10-02',
        parks: [{ nome: 'X', dias: 1, data: '2026-10-02' }], totalValue: 10, currency: 'BRL',
      });
      d.repo.create.mockResolvedValue({ id: 'p1' });

      const out = await makeService(d).create(
        { conversationId: 'conv-1', checkoutUrl: 'https://reservas.orlandofastpass.com.br/pt/checkout/a', format: 'TEXT' } as any,
        'user-1', 'org-1', 'ALL' as any,
      );

      expect(d.render.render).toHaveBeenCalled();
      expect(d.extraction.extractQuoteFromImages).not.toHaveBeenCalled();
      expect(out).toEqual({ id: 'p1' });
    });
  });

  describe('listagem', () => {
    it('propostas QUOTE da conversa saem com quoteUrl e dados de abertura', async () => {
      const d = deps();
      const opened = new Date('2026-10-26T14:32:00.000Z');
      d.repo.listForContact.mockResolvedValue([
        {
          id: 'q1', kind: 'QUOTE', conversationId: 'conv-1', publicToken: 'tok_tok_tok_tok_tok_tok',
          expiresAt: NOW, viewCount: 2, firstViewedAt: opened, lastViewedAt: opened,
        },
        { id: 'p1', kind: 'PARKS', conversationId: 'conv-1', publicToken: null, expiresAt: null, viewCount: 0, firstViewedAt: null, lastViewedAt: null },
      ]);

      const out: any[] = await makeService(d).listForConversation('org-1', 'conv-1');

      expect(out[0]).toEqual({
        id: 'q1', kind: 'QUOTE', conversationId: 'conv-1',
        quoteUrl: 'https://cotacao.orlandofastpass.com.br/tok_tok_tok_tok_tok_tok',
        expiresAt: NOW, viewCount: 2, firstViewedAt: opened, lastViewedAt: opened,
      });
      expect(out[1]).toEqual({ id: 'p1', kind: 'PARKS', conversationId: 'conv-1' });
    });
  });
});
