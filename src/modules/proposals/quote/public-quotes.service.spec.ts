import { GoneException, NotFoundException } from '@nestjs/common';
import { PublicQuotesService } from './public-quotes.service';
import { QUOTE_COMPANY } from '../quote-company';

const TOKEN = 'T'.repeat(32);
const NOW = new Date('2026-10-26T12:00:00.000Z');
const quote = {
  items: [
    {
      provider: 'Universal', title: 'Ingresso', startDate: '2026-12-10', endDate: '2026-12-10',
      description: null, adults: 2, children: 0, priceAdult: null, priceChild: null, total: 900,
      cancellationPolicy: null,
    },
  ],
  currency: 'BRL', total: 900, pixTotal: null, installments: null, notes: null,
};

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'cm9prop8k2q1z',
    kind: 'QUOTE',
    createdAt: new Date('2026-10-26T10:00:00.000Z'),
    expiresAt: new Date('2026-10-27T10:00:00.000Z'),
    createdById: 'user-1',
    conversationId: 'conv-1',
    details: { images: [{ url: 'https://x/a.png', mimeType: 'image/png' }], quote, customerName: 'Ana Souza' },
    ...over,
  };
}

function make(found: unknown = row()) {
  const channel = { id: 'chan-1', type: 'WHATSAPP_OFFICIAL', config: {} };
  const prisma = {
    proposal: {
      findUnique: jest.fn().mockResolvedValue(found),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Mariana Lima' }) },
    conversation: { findUnique: jest.fn().mockResolvedValue({ channel }) },
  } as any;
  const seller = { resolve: jest.fn().mockResolvedValue('551151984190') } as any;
  const pdf = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF')) } as any;
  return { svc: new PublicQuotesService(prisma, seller, pdf), prisma, seller, pdf, channel };
}

describe('PublicQuotesService', () => {
  const env = { ...process.env };

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    process.env.QUOTE_PUBLIC_URL = 'https://cotacao.orlandofastpass.com.br';
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...env };
  });

  describe('view', () => {
    it('monta a resposta pública do contrato', async () => {
      const { svc, prisma, seller, channel } = make();

      const out = await svc.view(TOKEN);

      expect(out).toEqual({
        status: 'ACTIVE',
        code: '8K2Q1Z',
        customerName: 'Ana Souza',
        seller: { name: 'Mariana Lima', whatsapp: '551151984190' },
        createdAt: '2026-10-26T10:00:00.000Z',
        expiresAt: '2026-10-27T10:00:00.000Z',
        quote,
        company: QUOTE_COMPANY,
      });
      expect(prisma.proposal.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { publicToken: TOKEN } }),
      );
      expect(seller.resolve).toHaveBeenCalledWith(channel);
    });

    it('não vaza nenhum campo interno (lista explícita de chaves)', async () => {
      const { svc } = make();

      const out = await svc.view(TOKEN);

      expect(Object.keys(out).sort()).toEqual(
        ['code', 'company', 'createdAt', 'customerName', 'expiresAt', 'quote', 'seller', 'status'].sort(),
      );
      expect(Object.keys(out.seller).sort()).toEqual(['name', 'whatsapp']);
      const json = JSON.stringify(out);
      for (const internal of ['cm9prop8k2q1z', 'user-1', 'conv-1', 'chan-1', 'images', 'organizationId', 'contactId', TOKEN]) {
        expect(json).not.toContain(internal);
      }
    });

    it('EXPIRED quando a validade passou', async () => {
      const { svc } = make(row({ expiresAt: new Date('2026-10-26T11:59:59.000Z') }));

      expect((await svc.view(TOKEN)).status).toBe('EXPIRED');
    });

    it('404 quando não existe', async () => {
      await expect(make(null).svc.view(TOKEN)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 quando não é QUOTE (proposta em texto com token não abre)', async () => {
      await expect(make(row({ kind: 'PARKS' })).svc.view(TOKEN)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 quando o JSON gravado não tem cotação', async () => {
      await expect(make(row({ details: { images: [] } })).svc.view(TOKEN)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('vendedor apagado: nome da empresa; canal sem número: whatsapp null; sem nome do cliente: null', async () => {
      const { svc, prisma, seller } = make(row({ details: { quote } }));
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.conversation.findUnique.mockResolvedValue(null);
      seller.resolve.mockResolvedValue(null);

      const out = await svc.view(TOKEN);

      expect(out.seller).toEqual({ name: 'Orlando Fast Pass', whatsapp: null });
      expect(out.customerName).toBeNull();
      expect(seller.resolve).toHaveBeenCalledWith(null);
    });
  });

  describe('markViewed', () => {
    it('incrementa, marca a primeira abertura só se nula e a última sempre', async () => {
      const { svc, prisma } = make();

      expect(await svc.markViewed(TOKEN)).toEqual({ ok: true });

      expect(prisma.proposal.update).toHaveBeenCalledWith({
        where: { id: 'cm9prop8k2q1z' },
        data: { viewCount: { increment: 1 }, lastViewedAt: NOW },
      });
      expect(prisma.proposal.updateMany).toHaveBeenCalledWith({
        where: { id: 'cm9prop8k2q1z', firstViewedAt: null },
        data: { firstViewedAt: NOW },
      });
    });

    it('404 para token que não é de cotação, sem gravar', async () => {
      const { svc, prisma } = make(row({ kind: 'OTHER' }));

      await expect(svc.markViewed(TOKEN)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.proposal.update).not.toHaveBeenCalled();
    });
  });

  describe('pdf', () => {
    it('gera o PDF com a view e o link da cotação', async () => {
      const { svc, pdf } = make();

      const out = await svc.pdf(TOKEN);

      expect(out).toEqual({ buffer: Buffer.from('%PDF'), filename: 'cotacao-8K2Q1Z.pdf' });
      expect(pdf.render).toHaveBeenCalledWith(
        expect.objectContaining({ code: '8K2Q1Z', status: 'ACTIVE' }),
        `https://cotacao.orlandofastpass.com.br/${TOKEN}`,
      );
    });

    it('410 quando expirada, sem abrir o gerador', async () => {
      const { svc, pdf } = make(row({ expiresAt: new Date('2026-10-26T11:00:00.000Z') }));

      await expect(svc.pdf(TOKEN)).rejects.toBeInstanceOf(GoneException);
      expect(pdf.render).not.toHaveBeenCalled();
    });
  });
});
