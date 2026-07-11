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
    pipelines: { enterStageForConversation: jest.fn().mockResolvedValue(undefined) } as any,
  };
}

describe('ProposalsService', () => {
  const url = 'https://reservas.orlandofastpass.com.br/pt/checkout/abc';

  it('renderiza, extrai, persiste e envia a proposta', async () => {
    const d = deps();
    const service = new ProposalsService(d.prisma, d.render, d.extraction, d.repo, d.messages, d.pipelines);

    const result = await service.create(
      { conversationId: 'conv-1', checkoutUrl: url },
      'user-1', 'org-1', 'ALL' as any,
    );

    expect(d.render.render).toHaveBeenCalledWith(url);
    expect(d.extraction.extract).toHaveBeenCalledWith('org-1', 'TEXTO RENDER', url);
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
    const service = new ProposalsService(d.prisma, d.render, d.extraction, d.repo, d.messages, d.pipelines);

    await expect(
      service.create({ conversationId: 'conv-1', checkoutUrl: url }, 'user-1', 'org-1', 'ALL' as any),
    ).rejects.toThrow(/não foi possível ler o carrinho/i);
    expect(d.messages.send).not.toHaveBeenCalled();
    expect(d.repo.create).not.toHaveBeenCalled();
  });

  it('rejeita conversa de outra org', async () => {
    const d = deps();
    d.prisma.conversation.findUnique.mockResolvedValue({ id: 'conv-1', organizationId: 'outra', contactId: 'c' });
    const service = new ProposalsService(d.prisma, d.render, d.extraction, d.repo, d.messages, d.pipelines);

    await expect(
      service.create({ conversationId: 'conv-1', checkoutUrl: url }, 'user-1', 'org-1', 'ALL' as any),
    ).rejects.toThrow();
    expect(d.render.render).not.toHaveBeenCalled();
  });

  it('extrai a URL de dentro de um bloco colado (link + resumo) e passa o bloco como contexto', async () => {
    const d = deps();
    const service = new ProposalsService(d.prisma, d.render, d.extraction, d.repo, d.messages, d.pipelines);
    const pasted = `${url}\n\nPROMOÇÃO DISNEY 4 PARKS MAGIC TICKET [4 dias]\n29/07/2026\n3 Adultos\n1 Criança`;

    await service.create(
      { conversationId: 'conv-1', checkoutUrl: pasted },
      'user-1', 'org-1', 'ALL' as any,
    );

    // renderiza a URL LIMPA extraída do bloco
    expect(d.render.render).toHaveBeenCalledWith(url);
    // passa o texto renderizado + o bloco colado inteiro como contexto
    expect(d.extraction.extract).toHaveBeenCalledWith('org-1', 'TEXTO RENDER', pasted);
    // persiste a URL limpa (não o bloco)
    expect(d.repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutUrl: url }),
    );
  });

  it('erro amigável quando não há link no que foi colado', async () => {
    const d = deps();
    const service = new ProposalsService(d.prisma, d.render, d.extraction, d.repo, d.messages, d.pipelines);
    await expect(
      service.create(
        { conversationId: 'conv-1', checkoutUrl: 'só um texto sem link nenhum' },
        'user-1', 'org-1', 'ALL' as any,
      ),
    ).rejects.toThrow(/não encontrei um link/i);
    expect(d.render.render).not.toHaveBeenCalled();
  });

  it('rejeita URL de host não permitido (SSRF guard)', async () => {
    const d = deps();
    const service = new ProposalsService(d.prisma, d.render, d.extraction, d.repo, d.messages, d.pipelines);
    await expect(
      service.create(
        { conversationId: 'conv-1', checkoutUrl: 'https://evil.example.com/x' },
        'user-1', 'org-1', 'ALL' as any,
      ),
    ).rejects.toThrow(/não é de um checkout permitido/i);
    expect(d.render.render).not.toHaveBeenCalled();
  });

  it('avança o card para "Proposta enviada" depois de enviar', async () => {
    const d = deps();
    const service = new ProposalsService(
      d.prisma, d.render, d.extraction, d.repo, d.messages, d.pipelines,
    );

    await service.create(
      { conversationId: 'conv-1', checkoutUrl: url },
      'user-1', 'org-1', 'ALL' as any,
    );

    expect(d.pipelines.enterStageForConversation).toHaveBeenCalledWith(
      'conv-1',
      'org-1',
      { pipelineName: 'Vendas OFP', stageName: 'Proposta enviada' },
    );
  });

  it('não quebra o envio se o avanço de etapa falhar', async () => {
    const d = deps();
    d.pipelines.enterStageForConversation.mockRejectedValue(new Error('boom'));
    const service = new ProposalsService(
      d.prisma, d.render, d.extraction, d.repo, d.messages, d.pipelines,
    );

    const result = await service.create(
      { conversationId: 'conv-1', checkoutUrl: url },
      'user-1', 'org-1', 'ALL' as any,
    );

    expect(d.messages.send).toHaveBeenCalled();
    expect(result).toEqual({ id: 'prop-1' });
  });
});
