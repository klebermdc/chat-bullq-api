import { ProposalsRepository } from './proposals.repository';

/** updateQuote: a versão nova grava o link da loja; a anterior vai inteira para proposal_versions. */
describe('ProposalsRepository.updateQuote — link da loja', () => {
  const NOW = new Date('2026-11-06T12:00:00.000Z');
  const baseQuote = {
    items: [], currency: 'BRL', total: 100, pixTotal: null, installments: null, notes: null,
  };
  const current: any = {
    id: 'prop-1',
    quoteVersion: 1,
    totalValue: 100,
    expiresAt: new Date('2026-11-07T12:00:00.000Z'),
    details: { images: [], customerName: 'Ana', quote: { ...baseQuote, storeUrl: 'https://loja.exemplo.com/antigo' } },
  };
  const cart = { adults: 1, children: 0, startDate: NOW.toISOString(), endDate: NOW.toISOString(), parks: [], totalValue: 120, currency: 'BRL' };

  function make() {
    const tx = {
      proposal: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUnique: jest.fn().mockResolvedValue({ id: 'prop-1' }) },
      proposalVersion: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    return { repo: new ProposalsRepository(prisma), tx };
  }

  it('grava o link novo na cotação e guarda o antigo na versão anterior', async () => {
    const { repo, tx } = make();
    const quote = { ...baseQuote, total: 120, storeUrl: 'https://loja.exemplo.com/novo' };

    await repo.updateQuote(current, { quote: quote as any, customerName: 'Ana', cart, expiresAt: NOW, editedById: 'user-2', now: NOW });

    const saved = tx.proposal.updateMany.mock.calls[0][0].data.details;
    expect(saved.quote.storeUrl).toBe('https://loja.exemplo.com/novo');
    const version = tx.proposalVersion.create.mock.calls[0][0].data;
    expect(version.details.quote.storeUrl).toBe('https://loja.exemplo.com/antigo');
    expect(version.version).toBe(1);
  });
});
