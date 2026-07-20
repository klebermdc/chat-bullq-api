import { OrderFichaService } from './order-ficha.service';

describe('OrderFichaService.ingestMessage', () => {
  const relevance = { isOrderMessage: jest.fn() } as any;
  const extractor = { extract: jest.fn() } as any;
  const repo = { upsertOrder: jest.fn() } as any;
  const messages = { recentCustomerTexts: jest.fn().mockResolvedValue(['quero 4 ingressos']) } as any;
  const svc = new OrderFichaService(relevance, extractor, repo, messages);

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
});
