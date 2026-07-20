import { OrderFichaService } from './order-ficha.service';

describe('OrderFichaService.ingestMessage', () => {
  const relevance = { isOrderMessage: jest.fn() } as any;
  const extractor = { extract: jest.fn() } as any;
  const repo = { upsertOrder: jest.fn() } as any;
  const messages = { recentCustomerTexts: jest.fn().mockResolvedValue(['quero 4 ingressos']) } as any;
  const divergence = { compare: jest.fn() } as any;
  const alert = { raise: jest.fn() } as any;
  const svc = new OrderFichaService(relevance, extractor, repo, messages, divergence, alert);

  beforeEach(() => jest.clearAllMocks());

  it('não extrai quando o gate diz não', async () => {
    relevance.isOrderMessage.mockResolvedValue(false);
    await svc.ingestMessage({ organizationId: 'o1', contactId: 'c1', conversationId: 'cv1', messageId: 'm1', text: 'oi' });
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(repo.upsertOrder).not.toHaveBeenCalled();
  });

  it('extrai e faz upsert quando relevante e há itens', async () => {
    relevance.isOrderMessage.mockResolvedValue(true);
    extractor.extract.mockResolvedValue({ items: [{ produto: 'MK', quantidade: 4 }], travelDatesText: 'julho', travelStart: null, travelEnd: null });
    await svc.ingestMessage({ organizationId: 'o1', contactId: 'c1', conversationId: 'cv1', messageId: 'm1', text: 'quero 4 ingressos' });
    expect(repo.upsertOrder).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'cv1', sourceMessageId: 'm1' }));
  });

  it('não faz upsert se a extração vier vazia', async () => {
    relevance.isOrderMessage.mockResolvedValue(true);
    extractor.extract.mockResolvedValue({ items: [], travelDatesText: null, travelStart: null, travelEnd: null });
    await svc.ingestMessage({ organizationId: 'o1', contactId: 'c1', conversationId: 'cv1', messageId: 'm1', text: 'quero ingressos' });
    expect(repo.upsertOrder).not.toHaveBeenCalled();
  });

  it('ignora texto vazio', async () => {
    await svc.ingestMessage({ organizationId: 'o1', contactId: 'c1', conversationId: 'cv1', messageId: 'm1', text: '  ' });
    expect(relevance.isOrderMessage).not.toHaveBeenCalled();
  });

  it('crossCheckOnProposal: sem ficha => não faz nada', async () => {
    repo.findByConversation = jest.fn().mockResolvedValue(null);
    await svc.crossCheckOnProposal({ conversationId: 'cv1', channelId: 'ch1', proposalId: 'p1', cart: {} as any });
    expect(alert.raise).not.toHaveBeenCalled();
  });

  it('crossCheckOnProposal: com ficha => compara, grava status e alerta', async () => {
    repo.findByConversation = jest.fn().mockResolvedValue({ items: [{ produto: 'MK', quantidade: 4 }], travelStart: null, travelEnd: null, travelDatesText: null });
    repo.updateDivergences = jest.fn();
    divergence.compare = jest.fn().mockReturnValue([{ kind: 'ITEM_MISMATCH', message: 'x', detail: {}, detectedAt: 'now' }]);
    await svc.crossCheckOnProposal({ conversationId: 'cv1', channelId: 'ch1', proposalId: 'p1', cart: {} as any });
    expect(repo.updateDivergences).toHaveBeenCalledWith('cv1', expect.any(Array), 'DIVERGENT', 'p1');
    expect(alert.raise).toHaveBeenCalledWith('cv1', 'ch1', expect.any(Array));
  });
});
