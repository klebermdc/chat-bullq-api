import { HistoryScanService } from './history-scan.service';

describe('HistoryScanService.scan', () => {
  it('enfileira uma extração por conversa com a tag do agente', async () => {
    const prisma = {
      aiAgentChannel: { findFirst: jest.fn().mockResolvedValue({ agentId: 'guia', tagFilterId: 'tag-g', mode: 'SHADOW' }) },
      conversation: { findMany: jest.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]) },
    } as any;
    const queue = { add: jest.fn().mockResolvedValue({}) } as any;
    const svc = new HistoryScanService(prisma, queue);

    const r = await svc.scan('org1', 'guia');

    expect(prisma.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: 'org1', tags: { some: { tagId: 'tag-g' } } }),
    }));
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ enqueued: 2 });
  });

  it('retorna enqueued 0 quando o agente não tem vínculo SHADOW', async () => {
    const prisma = { aiAgentChannel: { findFirst: jest.fn().mockResolvedValue(null) }, conversation: { findMany: jest.fn() } } as any;
    const queue = { add: jest.fn() } as any;
    const svc = new HistoryScanService(prisma, queue);
    const r = await svc.scan('org1', 'guia');
    expect(r).toEqual({ enqueued: 0 });
    expect(queue.add).not.toHaveBeenCalled();
  });
});
