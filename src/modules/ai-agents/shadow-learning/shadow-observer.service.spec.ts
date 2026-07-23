import { ShadowObserverService } from './shadow-observer.service';

describe('ShadowObserverService.observe', () => {
  function make(opts: { assignments: any[]; convTagIds: string[]; contactTagIds?: string[] }) {
    const prisma = {
      conversation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1', organizationId: 'org1', channelId: 'ch1', contactId: 'ct1',
          tags: opts.convTagIds.map((tagId) => ({ tagId })),
        }),
      },
      aiAgentChannel: { findMany: jest.fn().mockResolvedValue(opts.assignments) },
      contactTag: { findMany: jest.fn().mockResolvedValue((opts.contactTagIds ?? []).map((tagId) => ({ tagId }))) },
    } as any;
    const queue = { add: jest.fn().mockResolvedValue({}) } as any;
    return { svc: new ShadowObserverService(prisma, queue), prisma, queue };
  }

  it('enfileira extração para agente SHADOW cuja tagFilter casa com a conversa', async () => {
    const { svc, queue } = make({ assignments: [{ agentId: 'guia', mode: 'SHADOW', tagFilterId: 'tag-guiamento' }], convTagIds: ['tag-guiamento'] });
    await svc.observe('c1');
    expect(queue.add).toHaveBeenCalledWith('extract_knowledge', { organizationId: 'org1', agentId: 'guia', conversationId: 'c1' }, expect.any(Object));
  });

  it('NÃO enfileira quando a tag não casa', async () => {
    const { svc, queue } = make({ assignments: [{ agentId: 'guia', mode: 'SHADOW', tagFilterId: 'tag-guiamento' }], convTagIds: ['outra'] });
    await svc.observe('c1');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('enfileira quando tagFilter é null (SHADOW sem filtro de tag)', async () => {
    const { svc, queue } = make({ assignments: [{ agentId: 'guia', mode: 'SHADOW', tagFilterId: null }], convTagIds: [] });
    await svc.observe('c1');
    expect(queue.add).toHaveBeenCalled();
  });

  it('casa pela tag do CONTATO quando a conversa não tem a tag', async () => {
    const { svc, queue } = make({ assignments: [{ agentId: 'guia', mode: 'SHADOW', tagFilterId: 'tag-guiamento' }], convTagIds: [], contactTagIds: ['tag-guiamento'] });
    await svc.observe('c1');
    expect(queue.add).toHaveBeenCalled();
  });

  it('nunca lança — swallow de erro', async () => {
    const { svc, prisma } = make({ assignments: [], convTagIds: [] });
    prisma.conversation.findUnique.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.observe('c1')).resolves.toBeUndefined();
  });
});
