import { PublicAiAgentsService } from './public-ai-agents.service';

function build() {
  const prisma = {
    aiAgent: {
      findMany: jest.fn().mockResolvedValue([{ id: 'ag1' }]),
      findFirst: jest.fn().mockResolvedValue({ id: 'ag1', organizationId: 'o' }),
    },
    aiAgentRun: { findMany: jest.fn().mockResolvedValue([{ id: 'r1' }]) },
  };
  return { prisma, service: new PublicAiAgentsService(prisma as any) };
}

describe('PublicAiAgentsService', () => {
  it('list escopa por org e exclui deletados', async () => {
    const { prisma, service } = build();
    await service.list('org1');
    const arg = prisma.aiAgent.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ organizationId: 'org1', deletedAt: null });
  });

  it('findOne rejeita agente de outra org (404)', async () => {
    const { prisma, service } = build();
    prisma.aiAgent.findFirst.mockResolvedValue(null);
    await expect(service.findOne('other', 'ag1')).rejects.toThrow();
  });

  it('listRuns valida o agent (findOne) antes e escopa por agentId+org com limit', async () => {
    const { prisma, service } = build();
    const out = await service.listRuns('org1', 'ag1', 10);
    expect(prisma.aiAgent.findFirst).toHaveBeenCalled();
    const arg = prisma.aiAgentRun.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ agentId: 'ag1', organizationId: 'org1' });
    expect(arg.take).toBe(10);
    expect(arg.orderBy).toEqual({ startedAt: 'desc' });
    expect(out).toEqual([{ id: 'r1' }]);
  });
});
