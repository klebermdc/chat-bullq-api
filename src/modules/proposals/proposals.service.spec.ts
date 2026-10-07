import { NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { ProposalsService } from './proposals.service';
import { ConversationAccessService } from '../messaging/conversations/conversation-access.service';
import { ExtractedCart, ExtractedOtherProposal } from './proposals.types';
import { buildOtherProposalMessage } from './message-builder';
import { PROPOSAL_NEW_FOLLOWUPS, PROPOSAL_NEW_FOLLOWUPS_OTHER } from './proposal-followups';
import { PROPOSAL_IMAGE_MAX_BYTES } from './proposals.constants';

const cart: ExtractedCart = {
  adults: 3, children: 0,
  startDate: '2026-10-02', endDate: '2026-10-06',
  parks: [{ nome: 'UNIVERSAL', dias: 5, data: '2026-10-02' }],
  totalValue: 4200, currency: 'BRL',
};

const carQuote: ExtractedOtherProposal = {
  kind: 'OTHER',
  title: 'TOYOTA COROLLA OU SIMILAR',
  lines: [
    'Alamo · Intermediário',
    '16 diárias · Tarifa sem proteção',
    'Km livre e taxas locais',
    'R$ 5.081,52 no Pix ou R$ 5.405,87 em 10x sem juros',
  ],
  totalValue: 5081.52,
  currency: 'BRL',
};

// Assinatura de PNG + enchimento: o service confere os bytes, não o mimeType
// que o cliente declarou.
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('print'),
]);

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
    extraction: {
      extract: jest.fn().mockResolvedValue(cart),
      extractFromImages: jest.fn().mockResolvedValue(carQuote),
    } as any,
    repo: { create: jest.fn().mockResolvedValue({ id: 'prop-1' }), listForContact: jest.fn() } as any,
    messages: { send: jest.fn().mockResolvedValue({ id: 'msg-1' }) } as any,
    pipelines: { ensureConversationAtStageByName: jest.fn().mockResolvedValue(undefined) } as any,
    orderFicha: { crossCheckOnProposal: jest.fn().mockResolvedValue(undefined) } as any,
    conversationAccess: makeConversationAccessService(
      'conversationsGuardFinds' in opts ? opts.conversationsGuardFinds : { id: 'conv-1' },
    ),
    storage: {
      stat: jest.fn().mockResolvedValue({ size: PNG_BYTES.byteLength, contentType: 'image/png' }),
      getBuffer: jest.fn().mockResolvedValue(PNG_BYTES),
    } as any,
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
    d.storage,
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

  it('includeLink=false envia a proposta sem o link do checkout, mas guarda o link', async () => {
    const d = deps();
    const service = makeService(d);

    await service.create(
      { conversationId: 'conv-1', checkoutUrl: url, includeLink: false },
      'user-1', 'org-1', 'ALL' as any,
    );

    const sent = d.messages.send.mock.calls[0][0];
    expect(sent.content.text).not.toContain(url);
    expect(sent.content.text).toContain('Proposta Orlando Fast Pass');
    expect(d.repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutUrl: url }),
    );
  });

  it('sem link e sem URL colada: lê o resumo, não abre carrinho e envia a proposta', async () => {
    const d = deps();
    const service = makeService(d);
    const resumo = 'DISNEY 4 PARKS [4 dias]\n29/07/2026\n3 Adultos\n1 Criança';

    const result = await service.create(
      { conversationId: 'conv-1', checkoutUrl: resumo, includeLink: false },
      'user-1', 'org-1', 'ALL' as any,
    );

    expect(d.render.render).not.toHaveBeenCalled();
    expect(d.extraction.extract).toHaveBeenCalledWith('org-1', resumo, undefined, {
      allowMissingTotal: true,
    });
    expect(d.repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutUrl: '', rawText: resumo }),
    );
    expect(d.messages.send.mock.calls[0][0].content.text).toContain('Proposta Orlando Fast Pass');
    expect(result).toEqual({ id: 'prop-1' });
  });

  it('sem link e sem valor no resumo: move o card sem zerar o valor do negócio', async () => {
    const d = deps();
    d.extraction.extract.mockResolvedValue({ ...cart, totalValue: 0 });
    const service = makeService(d);

    await service.create(
      { conversationId: 'conv-1', checkoutUrl: 'DISNEY 4 PARKS', includeLink: false },
      'user-1', 'org-1', 'ALL' as any,
    );

    expect(d.pipelines.ensureConversationAtStageByName).toHaveBeenCalledWith(
      'org-1', 'conv-1', 'PROPOSTA ENVIADA', undefined,
    );
  });

  it('com link (padrão): colar só o resumo continua pedindo o link', async () => {
    const d = deps();
    const service = makeService(d);

    await expect(
      service.create(
        { conversationId: 'conv-1', checkoutUrl: 'DISNEY 4 PARKS' },
        'user-1', 'org-1', 'ALL' as any,
      ),
    ).rejects.toThrow('Não encontrei um link de checkout');
  });

  it('sem link e nada colado: pede o resumo', async () => {
    const d = deps();
    const service = makeService(d);

    await expect(
      service.create(
        { conversationId: 'conv-1', checkoutUrl: '   ', includeLink: false },
        'user-1', 'org-1', 'ALL' as any,
      ),
    ).rejects.toThrow('Cole o resumo');
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

describe('ProposalsService.create — proposta com prints', () => {
  const url = 'https://reservas.orlandofastpass.com.br/pt/checkout/abc';
  const print = (n: number) => ({
    url: `https://api.x/api/v1/uploads/media/2026-10-07/${String(n).repeat(32)}.png`,
    mimeType: 'image/png',
    filename: `print-${n}.png`,
    size: 1024,
  });
  const keyOf = (n: number) => `media/2026-10-07/${String(n).repeat(32)}.png`;
  const args = ['user-1', 'org-1', 'ALL' as any] as const;

  it('só print, sem link e sem texto: lê as imagens do storage e extrai por visão', async () => {
    const d = deps();
    const service = makeService(d);

    const result = await service.create(
      { conversationId: 'conv-1', checkoutUrl: '', includeLink: false, images: [print(1), print(2)] },
      ...args,
    );

    expect(d.storage.getBuffer.mock.calls).toEqual([[keyOf(1)], [keyOf(2)]]);
    expect(d.render.render).not.toHaveBeenCalled();
    expect(d.extraction.extract).not.toHaveBeenCalled();
    const base64 = PNG_BYTES.toString('base64');
    expect(d.extraction.extractFromImages).toHaveBeenCalledWith(
      'org-1',
      {
        images: [
          { mediaType: 'image/png', data: base64 },
          { mediaType: 'image/png', data: base64 },
        ],
        renderedText: undefined,
        pastedText: '',
      },
      { allowMissingTotal: true },
    );
    expect(result).toEqual({ id: 'prop-1' });
  });

  it('OTHER: manda a mensagem do produto, sem pessoas/datas/parques', async () => {
    const d = deps();
    const service = makeService(d);

    await service.create(
      { conversationId: 'conv-1', checkoutUrl: '', includeLink: false, images: [print(1)], mode: 'UPDATE' },
      ...args,
    );

    expect(d.messages.send.mock.calls[0][0]).toEqual({
      conversationId: 'conv-1',
      type: 'TEXT',
      content: { text: buildOtherProposalMessage(carQuote, '', 'UPDATE', { includeLink: false }) },
    });
  });

  it('OTHER em proposta nova: a conferência enviada depois não fala em parques', async () => {
    const d = deps();
    const service = makeService(d);

    await service.create(
      { conversationId: 'conv-1', checkoutUrl: '', includeLink: false, images: [print(1)], mode: 'NEW' },
      ...args,
    );

    const texts = d.messages.send.mock.calls
      .map((call: any[]) => call[0])
      .filter((message: any) => message.type === 'TEXT')
      .map((message: any) => message.content.text as string);
    const followUps = texts.slice(1);
    expect(followUps).toHaveLength(2);
    expect(followUps[0]).toContain('revise com atenção os detalhes desta proposta');
    expect(followUps.join(' ')).not.toContain('parques');
    expect(followUps[1]).toContain('certificados');
  });

  it('OTHER: persiste kind, título/linhas/imagens em details e os campos de ingresso zerados', async () => {
    const d = deps();
    const service = makeService(d);
    const before = Date.now();

    await service.create(
      { conversationId: 'conv-1', checkoutUrl: 'cotação do carro', includeLink: false, images: [print(1)] },
      ...args,
    );

    const input = d.repo.create.mock.calls[0][0];
    expect(input).toEqual(
      expect.objectContaining({
        kind: 'OTHER',
        checkoutUrl: '',
        rawText: 'cotação do carro',
        details: { title: carQuote.title, lines: carQuote.lines, images: [print(1)] },
      }),
    );
    expect(input.cart).toEqual(
      expect.objectContaining({ adults: 0, children: 0, parks: [], totalValue: 5081.52, currency: 'BRL' }),
    );
    expect(input.cart.startDate).toBe(input.cart.endDate);
    const at = new Date(input.cart.startDate).getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it('OTHER: não cruza com a Ficha do Pedido e leva o valor à vista para o funil', async () => {
    const d = deps();
    const service = makeService(d);

    await service.create(
      { conversationId: 'conv-1', checkoutUrl: '', includeLink: false, images: [print(1)] },
      ...args,
    );

    expect(d.orderFicha.crossCheckOnProposal).not.toHaveBeenCalled();
    expect(d.pipelines.ensureConversationAtStageByName).toHaveBeenCalledWith(
      'org-1', 'conv-1', 'PROPOSTA ENVIADA', { value: 5081.52, currency: 'BRL' },
    );
  });

  it('OTHER sem valor: move o card sem mexer no valor do negócio', async () => {
    const d = deps();
    d.extraction.extractFromImages.mockResolvedValue({ ...carQuote, totalValue: 0 });
    const service = makeService(d);

    await service.create(
      { conversationId: 'conv-1', checkoutUrl: '', includeLink: false, images: [print(1)] },
      ...args,
    );

    expect(d.pipelines.ensureConversationAtStageByName).toHaveBeenCalledWith(
      'org-1', 'conv-1', 'PROPOSTA ENVIADA', undefined,
    );
  });

  it('ordem no fio: texto da proposta → prints (um por mensagem, na ordem) → follow-ups', async () => {
    const d = deps();
    const service = makeService(d);

    await service.create(
      { conversationId: 'conv-1', checkoutUrl: '', includeLink: false, images: [print(1), print(2)], mode: 'NEW' },
      ...args,
    );

    const sent = d.messages.send.mock.calls.map((c: any[]) => c[0]);
    expect(sent.map((m: any) => m.type)).toEqual([
      'TEXT', 'IMAGE', 'IMAGE', ...PROPOSAL_NEW_FOLLOWUPS.map(() => 'TEXT'),
    ]);
    expect(sent[1]).toEqual({
      conversationId: 'conv-1',
      type: 'IMAGE',
      content: { mediaUrl: print(1).url, mimeType: 'image/png', fileName: 'print-1.png', size: 1024 },
    });
    expect(sent[2].content.mediaUrl).toBe(print(2).url);
    // O print deste bloco é a cotação de carro (OTHER): conferência sem "parques".
    expect(sent[3].content.text).toBe(PROPOSAL_NEW_FOLLOWUPS_OTHER[0]);
    // todas pelo mesmo caminho da proposta (já autorizado acima)
    for (const call of d.messages.send.mock.calls) {
      expect(call.slice(1)).toEqual(['user-1', 'org-1', 'ALL', undefined, { system: true }]);
    }
  });

  it('modo UPDATE: texto e prints, sem follow-ups', async () => {
    const d = deps();
    const service = makeService(d);

    await service.create(
      { conversationId: 'conv-1', checkoutUrl: '', includeLink: false, images: [print(1)], mode: 'UPDATE' },
      ...args,
    );

    expect(d.messages.send.mock.calls.map((c: any[]) => c[0].type)).toEqual(['TEXT', 'IMAGE']);
  });

  it('print que falha no envio NÃO derruba a proposta nem os envios seguintes', async () => {
    const d = deps();
    d.messages.send.mockImplementation(async (m: any) => {
      if (m.type === 'IMAGE' && m.content.mediaUrl === print(1).url) throw new Error('provider fora');
      return { id: 'msg' };
    });
    const service = makeService(d);

    const result = await service.create(
      { conversationId: 'conv-1', checkoutUrl: '', includeLink: false, images: [print(1), print(2)], mode: 'NEW' },
      ...args,
    );

    expect(result).toEqual({ id: 'prop-1' });
    expect(d.messages.send).toHaveBeenCalledTimes(3 + PROPOSAL_NEW_FOLLOWUPS.length);
    expect(d.pipelines.ensureConversationAtStageByName).toHaveBeenCalled();
  });

  it('link + prints: renderiza o checkout e manda render, texto e imagens para a visão', async () => {
    const d = deps();
    d.extraction.extractFromImages.mockResolvedValue({ kind: 'PARKS', ...cart });
    const service = makeService(d);

    await service.create(
      { conversationId: 'conv-1', checkoutUrl: url, images: [print(1)] },
      ...args,
    );

    expect(d.render.render).toHaveBeenCalledWith(url);
    expect(d.extraction.extractFromImages).toHaveBeenCalledWith(
      'org-1',
      {
        images: [{ mediaType: 'image/png', data: PNG_BYTES.toString('base64') }],
        renderedText: 'TEXTO RENDER',
        pastedText: url,
      },
      { allowMissingTotal: false },
    );
    expect(d.messages.send.mock.calls[0][0].content.text).toContain(`👉 ${url}`);
  });

  it('PARKS com prints: mensagem de ingressos, cruza com a ficha e guarda as imagens em details', async () => {
    const d = deps();
    d.extraction.extractFromImages.mockResolvedValue({ kind: 'PARKS', ...cart });
    const service = makeService(d);

    await service.create(
      { conversationId: 'conv-1', checkoutUrl: '', includeLink: false, images: [print(1)], mode: 'UPDATE' },
      ...args,
    );

    expect(d.messages.send.mock.calls[0][0].content.text).toContain(
      'Para 3 Adultos entre os dias 02/10/2026 e 06/10/2026',
    );
    expect(d.repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'PARKS', cart, details: { images: [print(1)] } }),
    );
    expect(d.orderFicha.crossCheckOnProposal).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'prop-1', cart }),
    );
    expect(d.messages.send.mock.calls.map((c: any[]) => c[0].type)).toEqual(['TEXT', 'IMAGE']);
  });

  it('sem prints: nada muda — PARKS, details nulo, nenhuma leitura no storage', async () => {
    const d = deps();
    const service = makeService(d);

    await service.create({ conversationId: 'conv-1', checkoutUrl: url, mode: 'UPDATE' }, ...args);

    expect(d.repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'PARKS', details: null, cart }),
    );
    expect(d.storage.getBuffer).not.toHaveBeenCalled();
    expect(d.extraction.extractFromImages).not.toHaveBeenCalled();
    expect(d.messages.send).toHaveBeenCalledTimes(1);
    expect(d.orderFicha.crossCheckOnProposal).toHaveBeenCalled();
  });

  it('com link (padrão): print sem link continua pedindo o link', async () => {
    const d = deps();
    const service = makeService(d);

    await expect(
      service.create({ conversationId: 'conv-1', checkoutUrl: '', images: [print(1)] }, ...args),
    ).rejects.toThrow('Não encontrei um link de checkout');
    expect(d.storage.getBuffer).not.toHaveBeenCalled();
  });

  it.each([
    ['PDF de aceite de outro tenant', 'https://api.x/api/v1/uploads/acceptances/2026-08-06/abc.pdf'],
    ['URL de fora', 'https://evil.com/print.png'],
    ['path traversal', 'https://api.x/api/v1/uploads/media/../acceptances/x.pdf'],
    ['chave contrabandeada na query', 'https://evil.com/r?next=/api/v1/uploads/media/x.png'],
  ])('recusa imagem que não é upload nosso (%s) antes de ler qualquer coisa', async (_name, badUrl) => {
    const d = deps();
    const service = makeService(d);

    await expect(
      service.create(
        {
          conversationId: 'conv-1', checkoutUrl: '', includeLink: false,
          images: [print(1), { url: badUrl, mimeType: 'image/png' }],
        },
        ...args,
      ),
    ).rejects.toThrow('Imagem inválida.');
    expect(d.storage.stat).not.toHaveBeenCalled();
    expect(d.storage.getBuffer).not.toHaveBeenCalled();
    expect(d.extraction.extractFromImages).not.toHaveBeenCalled();
    expect(d.messages.send).not.toHaveBeenCalled();
  });

  it('imagem que não existe no storage: 400, sem extrair nem enviar', async () => {
    const d = deps();
    d.storage.stat.mockResolvedValue(null);
    const service = makeService(d);

    await expect(
      service.create(
        { conversationId: 'conv-1', checkoutUrl: '', includeLink: false, images: [print(1)] },
        ...args,
      ),
    ).rejects.toThrow('Imagem inválida.');
    expect(d.storage.getBuffer).not.toHaveBeenCalled();
    expect(d.extraction.extractFromImages).not.toHaveBeenCalled();
  });

  it('arquivo acima do teto não é carregado em memória', async () => {
    const d = deps();
    d.storage.stat.mockResolvedValue({ size: PROPOSAL_IMAGE_MAX_BYTES + 1, contentType: 'image/png' });
    const service = makeService(d);

    await expect(
      service.create(
        { conversationId: 'conv-1', checkoutUrl: '', includeLink: false, images: [print(1)] },
        ...args,
      ),
    ).rejects.toThrow(/Imagem muito grande/);
    expect(d.storage.getBuffer).not.toHaveBeenCalled();
  });

  it('arquivo que não é imagem de verdade (mimeType mentiroso) é recusado', async () => {
    const d = deps();
    d.storage.getBuffer.mockResolvedValue(Buffer.from('%PDF-1.7 aceite assinado'));
    const service = makeService(d);

    await expect(
      service.create(
        { conversationId: 'conv-1', checkoutUrl: '', includeLink: false, images: [print(1)] },
        ...args,
      ),
    ).rejects.toThrow('Imagem inválida.');
    expect(d.extraction.extractFromImages).not.toHaveBeenCalled();
  });

  it('o tipo mandado para a visão e para o cliente é o dos BYTES, não o declarado', async () => {
    const d = deps();
    d.storage.getBuffer.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
    const service = makeService(d);

    await service.create(
      { conversationId: 'conv-1', checkoutUrl: '', includeLink: false, images: [print(1)], mode: 'UPDATE' },
      ...args,
    );

    expect(d.extraction.extractFromImages.mock.calls[0][1].images[0].mediaType).toBe('image/jpeg');
    expect(d.messages.send.mock.calls[1][0].content.mimeType).toBe('image/jpeg');
    expect(d.repo.create.mock.calls[0][0].details.images[0].mimeType).toBe('image/jpeg');
  });

  it('print ilegível sem link: erro que explica o que o print precisa mostrar, sem enviar nada', async () => {
    const d = deps();
    d.extraction.extractFromImages.mockRejectedValue(
      new Error('Não foi possível ler a proposta (campos obrigatórios ausentes).'),
    );
    const service = makeService(d);

    await expect(
      service.create(
        { conversationId: 'conv-1', checkoutUrl: 'oi', includeLink: false, images: [print(1)] },
        ...args,
      ),
    ).rejects.toThrow(
      'Não consegui montar a proposta com o que foi enviado. O print ou o resumo precisa mostrar ' +
        'o produto e as condições (para ingressos: parques, datas e pessoas).',
    );
    expect(d.messages.send).not.toHaveBeenCalled();
    expect(d.repo.create).not.toHaveBeenCalled();
  });

  it('não muta o dto recebido', async () => {
    const d = deps();
    const service = makeService(d);
    const dto = Object.freeze({
      conversationId: 'conv-1',
      checkoutUrl: '',
      includeLink: false,
      images: Object.freeze([Object.freeze(print(1))]) as any,
    });

    await expect(service.create(dto as any, ...args)).resolves.toEqual({ id: 'prop-1' });
  });
});
