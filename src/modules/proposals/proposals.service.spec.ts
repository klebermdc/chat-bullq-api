import { ProposalsService } from './proposals.service';
import { ExtractedCart } from './proposals.types';

const cart: ExtractedCart = {
  adults: 3, children: 0,
  startDate: '2026-10-02', endDate: '2026-10-06',
  parks: [{ nome: 'UNIVERSAL', dias: 5, data: '2026-10-02' }],
  totalValue: 4200, currency: 'BRL',
};

function deps() {
  const conversation = { id: 'conv-1', organizationId: 'org-1', contactId: 'contact-1' };
  return {
    prisma: {
      conversation: { findUnique: jest.fn().mockResolvedValue(conversation) },
    } as any,
    render: { render: jest.fn().mockResolvedValue('TEXTO RENDER') } as any,
    extraction: { extract: jest.fn().mockResolvedValue(cart) } as any,
    repo: { create: jest.fn().mockResolvedValue({ id: 'prop-1' }), listForContact: jest.fn() } as any,
    messages: { send: jest.fn().mockResolvedValue({ id: 'msg-1' }) } as any,
  };
}

describe('ProposalsService', () => {
  const url = 'https://reservas.orlandofastpass.com.br/pt/checkout/abc';

  it('renderiza, extrai, persiste e envia a proposta', async () => {
    const d = deps();
    const service = new ProposalsService(d.prisma, d.render, d.extraction, d.repo, d.messages);

    const result = await service.create(
      { conversationId: 'conv-1', checkoutUrl: url },
      'user-1', 'org-1', 'ALL' as any,
    );

    expect(d.render.render).toHaveBeenCalledWith(url);
    expect(d.extraction.extract).toHaveBeenCalledWith('org-1', 'TEXTO RENDER');
    expect(d.repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', contactId: 'contact-1', checkoutUrl: url, cart }),
    );
    expect(d.messages.send).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', type: 'TEXT' }),
      'user-1', 'org-1', 'ALL',
    );
    expect(result).toEqual({ id: 'prop-1' });
  });

  it('NÃO envia mensagem se a extração falhar', async () => {
    const d = deps();
    d.extraction.extract.mockRejectedValue(new Error('Não foi possível ler o carrinho'));
    const service = new ProposalsService(d.prisma, d.render, d.extraction, d.repo, d.messages);

    await expect(
      service.create({ conversationId: 'conv-1', checkoutUrl: url }, 'user-1', 'org-1', 'ALL' as any),
    ).rejects.toThrow(/não foi possível ler o carrinho/i);
    expect(d.messages.send).not.toHaveBeenCalled();
    expect(d.repo.create).not.toHaveBeenCalled();
  });

  it('rejeita conversa de outra org', async () => {
    const d = deps();
    d.prisma.conversation.findUnique.mockResolvedValue({ id: 'conv-1', organizationId: 'outra', contactId: 'c' });
    const service = new ProposalsService(d.prisma, d.render, d.extraction, d.repo, d.messages);

    await expect(
      service.create({ conversationId: 'conv-1', checkoutUrl: url }, 'user-1', 'org-1', 'ALL' as any),
    ).rejects.toThrow();
    expect(d.render.render).not.toHaveBeenCalled();
  });
});
