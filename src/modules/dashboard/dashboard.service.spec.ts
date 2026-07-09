import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../database/prisma.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: { conversation: { groupBy: jest.Mock } };

  beforeEach(() => {
    prisma = {
      conversation: { groupBy: jest.fn() },
    };
    service = new DashboardService(prisma as unknown as PrismaService);
  });

  it('getLeadsBySource agrupa conversas por source no range e escopo', async () => {
    (prisma.conversation.groupBy as jest.Mock).mockResolvedValue([
      { source: 'CTWA', _count: { _all: 5 } },
      { source: 'SITE_FORM', _count: { _all: 3 } },
      { source: null, _count: { _all: 2 } },
    ]);
    const out = await service.getLeadsBySource(
      'org1',
      { from: new Date('2026-07-01'), to: new Date('2026-07-09') },
      undefined,
    );
    expect(out).toEqual([
      { source: 'CTWA', count: 5 },
      { source: 'SITE_FORM', count: 3 },
      { source: 'ORGANIC', count: 2 },
    ]);
  });

  it('getLeadsBySource escopa por assignedToId quando fornecido', async () => {
    (prisma.conversation.groupBy as jest.Mock).mockResolvedValue([]);
    await service.getLeadsBySource('org1', { from: new Date(), to: new Date() }, 'user1');
    expect(prisma.conversation.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['source'],
        where: expect.objectContaining({ organizationId: 'org1', assignedToId: 'user1' }),
      }),
    );
  });
});
