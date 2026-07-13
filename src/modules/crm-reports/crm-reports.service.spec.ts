import { Test } from '@nestjs/testing';
import { OrgRole } from '@prisma/client';
import { CrmReportsService } from './crm-reports.service';
import { PrismaService } from '../../database/prisma.service';

function makePrisma(overrides: any = {}) {
  return {
    card: {
      groupBy: jest.fn().mockResolvedValue([
        { status: 'WON', _count: { _all: 3 }, _sum: { value: 300 } },
        { status: 'LOST', _count: { _all: 1 }, _sum: { value: 50 } },
        { status: 'OPEN', _count: { _all: 2 }, _sum: { value: 200 } },
      ]),
      count: jest.fn().mockResolvedValue(6),
      findMany: jest.fn().mockResolvedValue([]),
      ...overrides.card,
    },
  } as any;
}

describe('CrmReportsService.getDealsReport (metrics)', () => {
  async function build(prisma: any) {
    const mod = await Test.createTestingModule({
      providers: [CrmReportsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return mod.get(CrmReportsService);
  }

  it('computa métricas de conversão e totais', async () => {
    const service = await build(makePrisma());
    const r = await service.getDealsReport({
      orgId: 'o1',
      role: OrgRole.ADMIN,
      userId: 'u1',
    } as any);
    expect(r.metrics.count).toBe(6);
    expect(r.metrics.totalValue).toBe(550);
    expect(r.metrics.won).toEqual({ count: 3, value: 300 });
    expect(r.metrics.lost).toEqual({ count: 1, value: 50 });
    expect(r.metrics.conversionRate).toBeCloseTo(0.75); // 3 / (3+1)
    expect(r.metrics.avgWonTicket).toBe(100); // 300/3
  });

  it('AGENT restringe o WHERE aos deals dele', async () => {
    const prisma = makePrisma();
    const service = await build(prisma);
    await service.getDealsReport({
      orgId: 'o1',
      role: OrgRole.AGENT,
      userId: 'u9',
    } as any);
    const whereArg = prisma.card.groupBy.mock.calls[0][0].where;
    expect(whereArg.OR).toEqual([
      { assignedToId: 'u9' },
      { conversation: { is: { assignedToId: 'u9' } } },
    ]);
  });
});
