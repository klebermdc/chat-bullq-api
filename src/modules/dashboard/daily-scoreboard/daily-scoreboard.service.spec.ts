import { DailyScoreboardService } from './daily-scoreboard.service';

function makePrisma() {
  return {
    organization: { findUnique: jest.fn().mockResolvedValue({ aiTimezone: 'America/Sao_Paulo' }) },
    conversation: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    userOrganization: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  } as any;
}

describe('DailyScoreboardService — conversas consideradas abertas', () => {
  it('inclui a distribuída que ainda está com a IA (BOT com dono), mas não a BOT sem dono', async () => {
    const prisma = makePrisma();
    await new DailyScoreboardService(prisma).getDailyScoreboard('org1', '2026-11-08');

    const where = prisma.conversation.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { status: { in: ['PENDING', 'OPEN', 'WAITING'] } },
      { status: 'BOT', assignedToId: { not: null } },
    ]);
    expect(where).toMatchObject({ organizationId: 'org1', isGroup: false, deletedAt: null, isArchived: false });
  });
});
