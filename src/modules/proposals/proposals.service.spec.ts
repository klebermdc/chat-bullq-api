import { NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { ProposalsService } from './proposals.service';
import { ConversationAccessService } from '../messaging/conversations/conversation-access.service';
import { ExtractedCart } from './proposals.types';

const cart: ExtractedCart = {
  adults: 3, children: 0,
  startDate: '2026-10-02', endDate: '2026-10-06',
  parks: [{ nome: 'UNIVERSAL', dias: 5, data: '2026-10-02' }],
  totalValue: 4200, currency: 'BRL',
};

/**
 * Instância REAL de ConversationAccessService (leaf service, só `prisma`),
 * mesmo padrão de messages.access.spec.ts / pipelines.card-access.spec.ts —
 * prova a integração de verdade com `assertConversationAccess`, não um
 * double.
 */
function makeConversationAccessService(conversationFound: unknown) {
  const prisma: any = {
    conversation: { findFirst: jest.fn().mockResolvedValue(conversationFound) },
  };
  return new ConversationAccessService(prisma);
}

function deps(opts: { conversationsGuardFinds?: unknown } = {}) {
  const conversation = { id: 'conv-1', organizationId: 'org-1', contactId: 'contact-1', channelId: 'chan-1' };
  return {
    prisma: {
      conversation: { findUnique: jest.fn().mockResolvedValue(conversation) },
    } as any,
    render: { render: jest.fn().mockResolvedValue('TEXTO RENDER') } as any,
    extraction: { extract: jest.fn().mockResolvedValue(cart) } as any,
    repo: { create: jest.fn().mockResolvedValue({ id: 'prop-1' }), listForContact: jest.fn() } as any,
    messages: { send: jest.fn().mockResolvedValue({ id: 'msg-1' }) } as any,
    pipelines: { ensureConversationAtStageByName: jest.fn().mockResolvedValue(undefined) } as any,
    orderFicha: { crossCheckOnProposal: jest.fn().mockResolvedValue(undefined) } as any,
    conversationAccess: makeConversationAccessService(
      'conversationsGuardFinds' in opts ? opts.conversationsGuardFinds : { id: 'conv-1' },
    ),
  };
}

function makeService(d: ReturnType<typeof deps>) {
  return new ProposalsService(
    d.prisma,
    d.render,
    d.extraction,
    d.repo,
    d.messages,
    d.pipelines,
    d.orderFicha,
    d.conversationAccess,
  );
}

describe('ProposalsService', () => {
  const url = 'https://reservas.orlandofastpass.com.br/pt/checkout/abc';

  it('renderiza, extrai, persiste e envia a proposta', async () => {
    const d = deps();
    const service = makeService(d);

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
      undefined,
      { system: true },
    );
    expect(result).toEqual({ id: 'prop-1' });
  });

  it('liga a conversa ao pipeline em PROPOSTA ENVIADA com o valor da proposta', async () => {
    const d = deps();
    const service = makeService(d);
    await service.create(
      { conversationId: 'conv-1', checkoutUrl: url },
      'user-1', 'org-1', 'ALL' as any,
    );
    expect(d.pipelines.ensureConversationAtStageByName).toHaveBeenCalledWith(
      'org-1',
      'conv-1',
      'PROPOSTA ENVIADA',
      { value: cart.totalValue, currency: cart.currency },
    );
  });

  it('falha no pipeline NÃO quebra o envio da proposta', async () => {
    const d = deps();
    d.pipelines.ensureConversationAtStageByName.mockRejectedValue(new Error('boom'));
    const service = makeService(d);
    const result = await service.create(
      { conversationId: 'conv-1', checkoutUrl: url },
      'user-1', 'org-1', 'ALL' as any,
    );
    expect(result).toEqual({ id: 'prop-1' });
    expect(d.messages.send).toHaveBeenCalled();
  });

  it('modo NEW envia as mensagens de follow-up depois da proposta; UPDATE não', async () => {
    const dNew = deps();
    const svcNew = makeService(dNew);
    await svcNew.create(
      { conversationId: 'conv-1', checkoutUrl: url, mode: 'NEW' },
      'user-1', 'org-1', 'ALL' as any,
    );
    // 1 proposta + os follow-ups
    expect(dNew.messages.send.mock.calls.length).toBeGreaterThan(1);

    const dUpd = deps();
    const svcUpd = makeService(dUpd);
    await svcUpd.create(
      { conversationId: 'conv-1', checkoutUrl: url, mode: 'UPDATE' },
      'user-1', 'org-1', 'ALL' as any,
    );
    // só a proposta, sem follow-ups
    expect(dUpd.messages.send).toHaveBeenCalledTimes(1);
  });

  it('NÃO envia mensagem se a extração falhar', async () => {
    const d = deps();
    d.extraction.extract.mockRejectedValue(new Error('Não foi possível ler o carrinho'));
    const service = makeService(d);

    await expect(
      service.create({ conversationId: 'conv-1', checkoutUrl: url }, 'user-1', 'org-1', 'ALL' as any),
    ).rejects.toThrow(/não foi possível ler o carrinho/i);
    expect(d.messages.send).not.toHaveBeenCalled();
    expect(d.repo.create).not.toHaveBeenCalled();
  });

  it('rejeita conversa de outra org', async () => {
    const d = deps();
    d.prisma.conversation.findUnique.mockResolvedValue({ id: 'conv-1', organizationId: 'outra', contactId: 'c' });
    const service = makeService(d);

    await expect(
      service.create({ conversationId: 'conv-1', checkoutUrl: url }, 'user-1', 'org-1', 'ALL' as any),
    ).rejects.toThrow();
    expect(d.render.render).not.toHaveBeenCalled();
  });

  it('extrai a URL de dentro de um bloco colado (link + resumo) e passa o bloco como contexto', async () => {
    const d = deps();
    const service = makeService(d);
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
    const service = makeService(d);
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
    const service = makeService(d);
    await expect(
      service.create(
        { conversationId: 'conv-1', checkoutUrl: 'https://evil.example.com/x' },
        'user-1', 'org-1', 'ALL' as any,
      ),
    ).rejects.toThrow(/não é de um checkout permitido/i);
    expect(d.render.render).not.toHaveBeenCalled();
  });
});

describe('ProposalsService.create — escopo por atribuição', () => {
  const url = 'https://reservas.orlandofastpass.com.br/pt/checkout/abc';

  it('AGENT + conversa de colega → NotFound, sem renderizar nem persistir', async () => {
    const d = deps({ conversationsGuardFinds: null }); // findFirst escopado não acha nada
    const service = makeService(d);

    await expect(
      service.create(
        { conversationId: 'conv-1', checkoutUrl: url },
        'agent-u1', 'org-1', 'ALL' as any, OrgRole.AGENT,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(d.render.render).not.toHaveBeenCalled();
    expect(d.repo.create).not.toHaveBeenCalled();
  });

  it('AGENT + conversa própria → passa da guarda e cria a proposta', async () => {
    const d = deps({ conversationsGuardFinds: { id: 'conv-1' } });
    const service = makeService(d);

    const result = await service.create(
      { conversationId: 'conv-1', checkoutUrl: url },
      'agent-u1', 'org-1', 'ALL' as any, OrgRole.AGENT,
    );
    expect(result).toEqual({ id: 'prop-1' });
  });

  it('ADMIN não é barrado mesmo quando a conversa não é dele', async () => {
    // Guard de ADMIN não escopa por assignedToId — devolve sem cláusula de
    // atribuição, então mesmo um mock que "acharia null" pra AGENT aqui nem
    // entra no caminho escopado.
    const d = deps({ conversationsGuardFinds: { id: 'conv-1' } });
    const service = makeService(d);

    const result = await service.create(
      { conversationId: 'conv-1', checkoutUrl: url },
      'admin-u1', 'org-1', 'ALL' as any, OrgRole.ADMIN,
    );
    expect(result).toEqual({ id: 'prop-1' });
  });
});

describe('ProposalsService.listForContact / listForConversation — escopo por atribuição', () => {
  function proposalsFixture() {
    return [
      { id: 'p1', conversationId: 'conv-mine', contactId: 'c1' },
      { id: 'p2', conversationId: 'conv-colega', contactId: 'c1' },
    ] as any[];
  }

  it('AGENT: listForContact devolve só as propostas de conversas atribuídas a ele', async () => {
    const d = deps();
    d.repo.listForContact = jest.fn().mockResolvedValue(proposalsFixture());
    d.prisma.conversation.findMany = jest
      .fn()
      .mockResolvedValue([{ id: 'conv-mine' }]); // só a própria conversa bate o where escopado
    const service = makeService(d);

    const result = await service.listForContact('org-1', 'c1', OrgRole.AGENT, 'agent-u1');

    expect(result).toEqual([{ id: 'p1', conversationId: 'conv-mine', contactId: 'c1' }]);
    expect(d.prisma.conversation.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['conv-mine', 'conv-colega'] }, assignedToId: 'agent-u1' },
      select: { id: true },
    });
  });

  it('ADMIN: listForContact devolve tudo, sem consultar conversas', async () => {
    const d = deps();
    d.repo.listForContact = jest.fn().mockResolvedValue(proposalsFixture());
    d.prisma.conversation.findMany = jest.fn();
    const service = makeService(d);

    const result = await service.listForContact('org-1', 'c1', OrgRole.ADMIN, 'admin-u1');

    expect(result).toEqual(proposalsFixture());
    expect(d.prisma.conversation.findMany).not.toHaveBeenCalled();
  });

  it('AGENT: listForConversation de conversa alheia devolve vazio', async () => {
    const d = deps();
    d.prisma.conversation.findUnique = jest
      .fn()
      .mockResolvedValue({ organizationId: 'org-1', contactId: 'c1' });
    d.repo.listForContact = jest.fn().mockResolvedValue(proposalsFixture());
    d.prisma.conversation.findMany = jest.fn().mockResolvedValue([]); // nenhuma conversa é do agent
    const service = makeService(d);

    const result = await service.listForConversation(
      'org-1', 'conv-colega', OrgRole.AGENT, 'agent-u1',
    );
    expect(result).toEqual([]);
  });
});
