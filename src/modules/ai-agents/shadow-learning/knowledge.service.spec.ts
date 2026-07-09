import { KnowledgeService } from './knowledge.service';

describe('KnowledgeService.recordItems', () => {
  function make(searchHits: any[] = []) {
    const prisma = {
      aiAgentKnowledge: {
        create: jest.fn().mockResolvedValue({ id: 'k-new' }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;
    const embeddings = { embed: jest.fn().mockResolvedValue({ vector: [0.1, 0.2] }) } as any;
    const store = { search: jest.fn().mockResolvedValue(searchHits) } as any;
    const ragQueue = { add: jest.fn().mockResolvedValue({}) } as any;
    const svc = new KnowledgeService(prisma, embeddings, store, ragQueue);
    return { svc, prisma, embeddings, store, ragQueue };
  }

  const item = { kind: 'qa' as const, category: 'fast-pass', content: 'reemitir no app', question: 'perdi o fast pass', confidence: 0.9 };

  it('cria conhecimento novo e enfileira indexação quando não há similar', async () => {
    const { svc, prisma, ragQueue } = make([]);
    await svc.recordItems('org1', 'a1', [item], { conversationId: 'c1' });

    expect(prisma.aiAgentKnowledge.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: 'org1', agentId: 'a1', kind: 'qa', category: 'fast-pass', content: 'reemitir no app' }),
    }));
    expect(ragQueue.add).toHaveBeenCalledWith('index_procedure', expect.objectContaining({
      type: 'index_procedure', knowledgeId: 'k-new', agentId: 'a1',
    }), expect.any(Object));
  });

  it('incrementa occurrences quando há similar (score alto) e NÃO cria novo', async () => {
    // SearchResult nests ownerId under `entry` (see rag/types.ts).
    const { svc, prisma, ragQueue } = make([{ entry: { ownerId: 'k-existing' }, score: 0.95 }]);
    await svc.recordItems('org1', 'a1', [item], { conversationId: 'c1' });

    expect(prisma.aiAgentKnowledge.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'k-existing' },
      data: expect.objectContaining({ occurrences: { increment: 1 } }),
    }));
    expect(prisma.aiAgentKnowledge.create).not.toHaveBeenCalled();
    expect(ragQueue.add).not.toHaveBeenCalled();
  });
});

describe('KnowledgeService.importCurated', () => {
  function make(existing: any[] = []) {
    const prisma = {
      aiAgentKnowledge: {
        findMany: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'k-' + data.question })),
      },
    } as any;
    const ragQueue = { add: jest.fn().mockResolvedValue({}) } as any;
    const svc = new KnowledgeService(prisma, {} as any, {} as any, ragQueue);
    return { svc, prisma, ragQueue };
  }
  const items = [
    { question: 'Funciona no Epcot?', content: 'Sim.', category: 'faq-geral' },
    { question: 'Garante zero fila?', content: 'Não.', category: 'faq-geral' },
  ];

  it('cria itens curados novos (source=faq, confidence 1) e indexa', async () => {
    const { svc, prisma, ragQueue } = make([]);
    const r = await svc.importCurated('org1', 'a1', items);
    expect(prisma.aiAgentKnowledge.create).toHaveBeenCalledTimes(2);
    expect(prisma.aiAgentKnowledge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: 'org1', agentId: 'a1', kind: 'qa', source: 'faq', confidence: 1, question: 'Funciona no Epcot?', content: 'Sim.', category: 'faq-geral' }),
    });
    expect(ragQueue.add).toHaveBeenCalledTimes(2);
    expect(ragQueue.add).toHaveBeenCalledWith('index_procedure', expect.objectContaining({ type: 'index_procedure', agentId: 'a1' }), expect.any(Object));
    expect(r).toEqual({ imported: 2, skipped: 0 });
  });

  it('pula perguntas já existentes com source=faq (idempotente, case-insensitive)', async () => {
    const { svc, prisma, ragQueue } = make([{ question: 'funciona no epcot?' }]);
    const r = await svc.importCurated('org1', 'a1', items);
    expect(prisma.aiAgentKnowledge.create).toHaveBeenCalledTimes(1);
    expect(prisma.aiAgentKnowledge.create).toHaveBeenCalledWith({ data: expect.objectContaining({ question: 'Garante zero fila?' }) });
    expect(ragQueue.add).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ imported: 1, skipped: 1 });
  });

  it('dedup DENTRO do mesmo lote (não cria a mesma pergunta duas vezes)', async () => {
    const { svc, prisma } = make([]);
    const dup = [items[0], { ...items[0], content: 'Sim, com foco.' }];
    const r = await svc.importCurated('org1', 'a1', dup);
    expect(prisma.aiAgentKnowledge.create).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ imported: 1, skipped: 1 });
  });

  it('ignora itens sem question/content e conta como skipped', async () => {
    const { svc, prisma } = make([]);
    const r = await svc.importCurated('org1', 'a1', [{ question: '', content: 'x', category: 'c' } as any, { question: 'ok?', content: '', category: 'c' } as any]);
    expect(prisma.aiAgentKnowledge.create).not.toHaveBeenCalled();
    expect(r).toEqual({ imported: 0, skipped: 2 });
  });
});

describe('KnowledgeService.list', () => {
  it('ordena por occurrences desc filtrando por org+agent', async () => {
    const prisma = { aiAgentKnowledge: { findMany: jest.fn().mockResolvedValue([{ id: 'k1' }]) } } as any;
    const svc = new KnowledgeService(prisma, {} as any, {} as any, {} as any);
    const r = await svc.list('org1', 'a1');
    expect(prisma.aiAgentKnowledge.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org1', agentId: 'a1' },
      orderBy: { occurrences: 'desc' },
    });
    expect(r).toEqual([{ id: 'k1' }]);
  });
});
