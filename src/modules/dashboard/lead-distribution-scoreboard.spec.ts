import { Test } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../database/prisma.service';

function makePrisma(overrides: any = {}) {
  return {
    organization: {
      findUnique: jest.fn().mockResolvedValue({ aiTimezone: 'America/Sao_Paulo' }),
    },
    conversation: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as any;
}

async function build(prisma: any) {
  const mod = await Test.createTestingModule({
    providers: [DashboardService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return mod.get(DashboardService);
}

describe('DashboardService.getLeadDistributionScoreboard', () => {
  // Pin "now" = 2026-07-20T12:00:00Z → em America/Sao_Paulo (UTC-3) = 2026-07-20 09:00.
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-20T12:00:00Z'));
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('conta hoje e mês por atendente (conversas por assignedToId), bucketiza na tz da org', async () => {
    const prisma = makePrisma({
      conversation: {
        findMany: jest.fn().mockResolvedValue([
          // Hoje (2026-07-20 local) para u1
          { assignedToId: 'u1', createdAt: new Date('2026-07-20T13:00:00Z') },
          // 2026-07-20T02:30:00Z = 2026-07-19 23:30 local → dia 19 (mês corrente, não hoje) para u1
          { assignedToId: 'u1', createdAt: new Date('2026-07-20T02:30:00Z') },
          // Hoje para u2
          { assignedToId: 'u2', createdAt: new Date('2026-07-20T14:00:00Z') },
        ]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'u1', name: 'Aline', avatarUrl: null },
          { id: 'u2', name: 'Bruno', avatarUrl: 'http://x/b.png' },
        ]),
      },
    });
    const service = await build(prisma);

    const r = await service.getLeadDistributionScoreboard('org1');

    expect(r.timezone).toBe('America/Sao_Paulo');
    expect(r.today).toBe('2026-07-20');
    // u1: 2 leads no mês (dias 20 e 19), 1 hoje → rankeado à frente de u2 (1 mês)
    expect(r.rows.map((x: any) => x.agent.id)).toEqual(['u1', 'u2']);
    expect(r.rows[0]).toMatchObject({ agent: { id: 'u1', name: 'Aline' }, today: 1, month: 2 });
    expect(r.rows[1]).toMatchObject({ agent: { id: 'u2', name: 'Bruno' }, today: 1, month: 1 });
    expect(r.rows[0].spark).toHaveLength(14);
    expect(r.rows[0].spark[13]).toEqual({ date: '2026-07-20', count: 1 }); // hoje
    expect(r.rows[0].spark[12]).toEqual({ date: '2026-07-19', count: 1 }); // ontem
  });

  it('AGENT (scope) filtra o WHERE por assignedToId e retorna só a própria linha', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { assignedToId: 'u1', createdAt: new Date('2026-07-20T13:00:00Z') },
    ]);
    const prisma = makePrisma({
      conversation: { findMany },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1', name: 'Aline', avatarUrl: null }]) },
    });
    const service = await build(prisma);

    const r = await service.getLeadDistributionScoreboard('org1', 'u1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org1',
          assignedToId: 'u1',
        }),
      }),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].agent.id).toBe('u1');
  });

  it('OWNER/ADMIN (sem scope) filtra assignedToId not null', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = makePrisma({ conversation: { findMany } });
    const service = await build(prisma);

    await service.getLeadDistributionScoreboard('org1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org1',
          assignedToId: { not: null },
        }),
      }),
    );
  });

  it('retorna rows vazio quando não há distribuição', async () => {
    const service = await build(makePrisma());
    const r = await service.getLeadDistributionScoreboard('org1');
    expect(r.rows).toEqual([]);
    expect(r.today).toBe('2026-07-20');
  });
});
