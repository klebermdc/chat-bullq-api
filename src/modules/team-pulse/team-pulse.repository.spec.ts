import { PENDING_HANDOFF, WITH_AI } from '../messaging/conversations/inbox-advanced-where';
import { TeamPulseRepository } from './team-pulse.repository';

const RANGE = { from: new Date('2026-11-19T17:00:00Z'), to: new Date('2026-11-19T18:00:00Z') };

function setup() {
  const prisma = {
    conversation: { count: jest.fn().mockResolvedValueOnce(9).mockResolvedValueOnce(4).mockResolvedValueOnce(3) },
    responseSlaRecord: {
      findMany: jest.fn().mockResolvedValue([{ agent: { name: 'Pedro' } }, { agent: null }]),
    },
  };
  return { prisma, repository: new TeamPulseRepository(prisma as never) };
}

describe('TeamPulseRepository', () => {
  it('conta as conversas novas e quantas estão com a Aline ou na fila', async () => {
    // Arrange
    const { prisma, repository } = setup();
    // Act
    const result = await repository.countLeads('org1', RANGE);
    // Assert
    expect(result).toEqual({ total: 9, withAi: 4, inQueue: 3 });
    const [total, withAi, inQueue] = prisma.conversation.count.mock.calls.map((c) => c[0].where);
    expect(total).toMatchObject({
      organizationId: 'org1',
      deletedAt: null,
      contact: { isMysteryShopper: false },
      createdAt: { gte: RANGE.from, lt: RANGE.to },
    });
    expect(withAi.AND).toContain(WITH_AI);
    expect(inQueue.AND).toContain(PENDING_HANDOFF);
    expect(withAi.AND[1]).toEqual({ status: { not: 'CLOSED' }, assignedToId: null });
  });

  it('lista os estouros de SLA do período com o nome do dono', async () => {
    const { prisma, repository } = setup();
    const result = await repository.listBreaches('org1', RANGE);
    expect(result).toEqual([{ agentName: 'Pedro' }, { agentName: null }]);
    expect(prisma.responseSlaRecord.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org1',
      breachedAt: { gte: RANGE.from, lt: RANGE.to },
    });
  });
});
