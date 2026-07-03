import { ConversationsRepository } from './conversations.repository';

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
