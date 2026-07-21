import { Test } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../database/prisma.service';

function makePrisma(overrides: any = {}) {
  return {
    organization: {
      findUnique: jest.fn().mockResolvedValue({ aiTimezone: 'America/Sao_Paulo' }),
    },
    conversationAuditLog: {
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

  it('conta hoje e mês por atendente, bucketiza na tz da org e ignora no-op', async () => {
    const prisma = makePrisma({
      conversationAuditLog: {
        findMany: jest.fn().mockResolvedValue([
          { toValue: 'u1', fromValue: null, createdAt: new Date('2026-07-20T13:00:00Z') },
          { toValue: 'u1', fromValue: 'u9', createdAt: new Date('2026-07-20T02:30:00Z') },
          { toValue: 'u2', fromValue: null, createdAt: new Date('2026-07-20T14:00:00Z') },
          { toValue: 'u2', fromValue: 'u2', createdAt: new Date('2026-07-20T15:00:00Z') },
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
    expect(r.rows.map((x: any) => x.agent.id)).toEqual(['u1', 'u2']);
    expect(r.rows[0]).toMatchObject({ agent: { id: 'u1', name: 'Aline' }, today: 1, month: 2 });
    expect(r.rows[1]).toMatchObject({ agent: { id: 'u2', name: 'Bruno' }, today: 1, month: 1 });
    expect(r.rows[0].spark).toHaveLength(14);
    expect(r.rows[0].spark[13]).toEqual({ date: '2026-07-20', count: 1 });
    expect(r.rows[0].spark[12]).toEqual({ date: '2026-07-19', count: 1 });
  });

  it('AGENT (scope) filtra o WHERE por toValue e retorna só a própria linha', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { toValue: 'u1', fromValue: null, createdAt: new Date('2026-07-20T13:00:00Z') },
    ]);
    const prisma = makePrisma({
      conversationAuditLog: { findMany },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1', name: 'Aline', avatarUrl: null }]) },
    });
    const service = await build(prisma);

    const r = await service.getLeadDistributionScoreboard('org1', 'u1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: 'ASSIGNED',
          conversation: { organizationId: 'org1' },
          toValue: 'u1',
        }),
      }),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].agent.id).toBe('u1');
  });

  it('retorna rows vazio quando não há distribuição', async () => {
    const service = await build(makePrisma());
    const r = await service.getLeadDistributionScoreboard('org1');
    expect(r.rows).toEqual([]);
    expect(r.today).toBe('2026-07-20');
  });
});
