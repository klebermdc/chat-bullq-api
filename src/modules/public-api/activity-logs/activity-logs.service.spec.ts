import { ActivityLogsService } from './activity-logs.service';

function build() {
  const prisma = {
    conversationAuditLog: {
      findMany: jest.fn().mockResolvedValue([{ id: 'a1' }]),
      count: jest.fn().mockResolvedValue(1),
    },
    $transaction: jest.fn().mockImplementation((arr) => Promise.all(arr)),
  };
  return { prisma, service: new ActivityLogsService(prisma as any) };
}

describe('ActivityLogsService.list', () => {
  it('escopa por org via conversation.organizationId e pagina', async () => {
    const { prisma, service } = build();
    const out = await service.list('org1', {}, 1, 20);
    const arg = prisma.conversationAuditLog.findMany.mock.calls[0][0];
    expect(arg.where.conversation).toEqual({ organizationId: 'org1' });
    expect(arg.skip).toBe(0);
    expect(arg.take).toBe(20);
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    expect(out).toEqual({ logs: [{ id: 'a1' }], total: 1 });
  });

  it('aplica filtros conversationId/actorId/action e intervalo de datas', async () => {
    const { prisma, service } = build();
    const from = new Date('2026-01-01');
    const to = new Date('2026-02-01');
    await service.list('org1', { conversationId: 'cv1', actorId: 'u1', action: 'ASSIGNED', from, to }, 2, 10);
    const arg = prisma.conversationAuditLog.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      conversation: { organizationId: 'org1' },
      conversationId: 'cv1', actorId: 'u1', action: 'ASSIGNED',
      createdAt: { gte: from, lte: to },
    });
    expect(arg.skip).toBe(10);
  });
});
