import { ConversationsRepository } from './conversations.repository';

describe('ConversationsRepository.findInbox (busca + etiqueta)', () => {
  const buildRepo = () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      conversation: { findMany, count },
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    };
    return {
      repo: new ConversationsRepository(prisma as any),
      whereOf: () => findMany.mock.calls[0][0].where,
    };
  };

  const andBlocks = (where: any) => (where.AND ?? []) as any[];
  const hasClause = (where: any, pick: (c: any) => unknown) =>
    andBlocks(where).some((block) => (block.OR ?? []).some(pick));

  it('busca por telefone com máscara casa o telefone gravado em dígitos', async () => {
    const { repo, whereOf } = buildRepo();

    await repo.findInbox(
      { organizationId: 'org-1', search: '(11) 98201-5967' },
      0,
      30,
    );

    expect(
      hasClause(
        whereOf(),
        (c) => c.contact?.phone?.contains === '11982015967',
      ),
    ).toBe(true);
  });

  // Regressão: o bloco do `search` fazia `where.OR = [...]`, apagando o OR que
  // o filtro de etiquetas tinha montado. Etiqueta + busca juntas descartavam a
  // etiqueta em silêncio.
  it('preserva o filtro de etiqueta quando há busca ao mesmo tempo', async () => {
    const { repo, whereOf } = buildRepo();

    await repo.findInbox(
      { organizationId: 'org-1', search: 'Maria', tagIds: ['tag-1'] },
      0,
      30,
    );

    const where = whereOf();
    expect(hasClause(where, (c) => c.tags?.some?.tagId?.in?.includes('tag-1'))).toBe(
      true,
    );
    expect(hasClause(where, (c) => c.contact?.name?.contains === 'Maria')).toBe(
      true,
    );
    // Duas restrições independentes: etiqueta E busca, não uma OU a outra.
    expect(andBlocks(where)).toHaveLength(2);
  });

  it('não monta AND quando não há busca nem etiqueta', async () => {
    const { repo, whereOf } = buildRepo();

    await repo.findInbox({ organizationId: 'org-1' }, 0, 30);

    expect(whereOf().AND).toBeUndefined();
  });
});

describe('ConversationsRepository.countByStatus (RN-05 assignment scope)', () => {
  const buildRepo = (groupBy: jest.Mock) => {
    const prisma = { conversation: { groupBy } };
    return new ConversationsRepository(prisma as any);
  };

  it('escopa a contagem por assignedToId quando enforceAssignedToId é passado (AGENT)', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const repo = buildRepo(groupBy);

    await repo.countByStatus('org-1', undefined, 'user-agent');

    expect(groupBy).toHaveBeenCalledTimes(1);
    const arg = groupBy.mock.calls[0][0];
    expect(arg.where.assignedToId).toBe('user-agent');
    expect(arg.where.organizationId).toBe('org-1');
  });

  it('NÃO adiciona assignedToId quando enforceAssignedToId é undefined (OWNER/ADMIN)', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const repo = buildRepo(groupBy);

    await repo.countByStatus('org-1', undefined, undefined);

    const arg = groupBy.mock.calls[0][0];
    expect(arg.where.assignedToId).toBeUndefined();
  });

  it('combina o escopo de atribuição com o teto de canais acessíveis', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const repo = buildRepo(groupBy);

    await repo.countByStatus('org-1', ['ch-1', 'ch-2'], 'user-agent');

    const arg = groupBy.mock.calls[0][0];
    expect(arg.where.assignedToId).toBe('user-agent');
    expect(arg.where.channelId).toEqual({ in: ['ch-1', 'ch-2'] });
  });

  it('retorna vazio (sem query) quando o usuário não tem canais acessíveis', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const repo = buildRepo(groupBy);

    const result = await repo.countByStatus('org-1', [], 'user-agent');

    expect(result).toEqual({});
    expect(groupBy).not.toHaveBeenCalled();
  });
});

describe('ConversationsRepository.findById (janela 24h/72h no detalhe)', () => {
  const buildRepo = (findUnique: jest.Mock) => {
    const prisma = { conversation: { findUnique } };
    return new ConversationsRepository(prisma as any);
  };

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

  it('anexa windowExpiresAt/windowKind — o front usa isto como fonte única', async () => {
    const lastInboundAt = hoursAgo(1);
    const findUnique = jest.fn().mockResolvedValue({
      id: 'c1',
      lastInboundAt,
      channel: { id: 'ch-1', type: 'WHATSAPP_OFFICIAL', name: 'Comercial' },
      contact: { ctwaClidAt: null },
    });
    const repo = buildRepo(findUnique);

    const out: any = await repo.findById('c1');

    expect(out.windowKind).toBe('csw24');
    expect(out.windowExpiresAt).toBe(
      new Date(lastInboundAt.getTime() + 24 * 3600_000).toISOString(),
    );
  });

  // Regressão: o detalhe vinha SEM windowExpiresAt e o inbox (refetch de 5s)
  // sobrescrevia o objeto da lista, derrubando a janela de CTWA pro fallback
  // de 24h — selo errado e compositor exigindo template das 24h às 72h.
  it('mantém a janela de 72h do CTWA mesmo com o inbound mais recente', async () => {
    const ctwaClidAt = hoursAgo(2);
    const findUnique = jest.fn().mockResolvedValue({
      id: 'c1',
      lastInboundAt: hoursAgo(1),
      channel: { id: 'ch-1', type: 'WHATSAPP_OFFICIAL', name: 'Comercial' },
      contact: { ctwaClidAt },
    });
    const repo = buildRepo(findUnique);

    const out: any = await repo.findById('c1');

    expect(out.windowKind).toBe('ctwa72');
    expect(out.windowExpiresAt).toBe(
      new Date(ctwaClidAt.getTime() + 72 * 3600_000).toISOString(),
    );
  });

  it('preserva os demais campos e devolve null quando a conversa não existe', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'c1',
      organizationId: 'org-1',
      assignedToId: 'user-1',
      lastInboundAt: null,
      channel: { id: 'ch-1', type: 'WHATSAPP_ZAPPFY', name: 'Zap' },
      contact: { ctwaClidAt: null },
    });
    const repo = buildRepo(findUnique);

    const out: any = await repo.findById('c1');
    expect(out.organizationId).toBe('org-1');
    expect(out.assignedToId).toBe('user-1');
    expect(out.windowExpiresAt).toBeNull();

    const missing = buildRepo(jest.fn().mockResolvedValue(null));
    expect(await missing.findById('nope')).toBeNull();
  });
});

describe('ConversationsRepository.countByTab (abas de atendimento)', () => {
  const buildRepo = (groupBy: jest.Mock) => {
    const prisma = { conversation: { groupBy } };
    return new ConversationsRepository(prisma as any);
  };

  it('mapeia status/awaitingHumanReply para as 3 abas (CLOSED sempre → finalizados)', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { status: 'PENDING', awaitingHumanReply: true, _count: 3 },
      { status: 'BOT', awaitingHumanReply: true, _count: 2 }, // bot respondeu → ainda esperando
      { status: 'OPEN', awaitingHumanReply: false, _count: 5 },
      { status: 'WAITING', awaitingHumanReply: false, _count: 1 },
      { status: 'CLOSED', awaitingHumanReply: true, _count: 4 }, // fechada ignora o flag
      { status: 'CLOSED', awaitingHumanReply: false, _count: 6 },
    ]);
    const repo = buildRepo(groupBy);

    const result = await repo.countByTab('org-1');

    expect(result).toEqual({ waiting: 5, inbox: 6, closed: 10 });
    const arg = groupBy.mock.calls[0][0];
    expect(arg.by).toEqual(['status', 'awaitingHumanReply']);
    expect(arg.where.isArchived).toBe(false);
    expect(arg.where.deletedAt).toBeNull();
  });

  it('escopa por assignedToId (RN-05) e por canal do topbar dentro do teto acessível', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const repo = buildRepo(groupBy);

    await repo.countByTab('org-1', {
      accessibleChannelIds: ['ch-1', 'ch-2'],
      enforceAssignedToId: 'user-agent',
      channelId: 'ch-2',
    });

    const arg = groupBy.mock.calls[0][0];
    expect(arg.where.assignedToId).toBe('user-agent');
    expect(arg.where.channelId).toBe('ch-2');
  });

  it('retorna zeros sem query quando o canal do topbar está fora do teto acessível', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const repo = buildRepo(groupBy);

    const result = await repo.countByTab('org-1', {
      accessibleChannelIds: ['ch-1'],
      channelId: 'ch-9',
    });

    expect(result).toEqual({ waiting: 0, inbox: 0, closed: 0 });
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('retorna zeros sem query quando não há canais acessíveis', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const repo = buildRepo(groupBy);

    const result = await repo.countByTab('org-1', { accessibleChannelIds: [] });

    expect(result).toEqual({ waiting: 0, inbox: 0, closed: 0 });
    expect(groupBy).not.toHaveBeenCalled();
  });
});
