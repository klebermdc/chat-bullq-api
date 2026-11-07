import {
  isResponseSlaEnabled,
  responseSlaByAgent,
  responseSlaCompliance,
  responseSlaDailySeries,
} from './response-sla-metrics';

const range = {
  from: new Date('2026-11-01T00:00:00Z'),
  to: new Date('2026-11-30T23:59:59Z'),
};

function prismaWith(rows: Array<Record<string, unknown>>, settings: unknown = { responseSlaMinutes: 15 }) {
  return {
    organization: { findUnique: jest.fn().mockResolvedValue({ settings }) },
    responseSlaRecord: { findMany: jest.fn().mockResolvedValue(rows) },
  };
}

const answered = (agentId: string, businessMinutes: number, breached = false, day = '2026-11-09') => ({
  agentId,
  waitingSince: new Date(`${day}T13:00:00Z`),
  respondedAt: new Date(`${day}T13:30:00Z`),
  businessMinutes,
  breached,
});
const breachedOpen = (agentId: string | null, day = '2026-11-09') => ({
  agentId,
  waitingSince: new Date(`${day}T13:00:00Z`),
  respondedAt: null,
  businessMinutes: null,
  breached: true,
});

describe('isResponseSlaEnabled', () => {
  it('liga só com settings.responseSlaMinutes válido', async () => {
    expect(await isResponseSlaEnabled(prismaWith([]) as any, 'org1')).toBe(true);
    expect(await isResponseSlaEnabled(prismaWith([], {}) as any, 'org1')).toBe(false);
  });
});

describe('responseSlaCompliance', () => {
  it('% de esperas respondidas dentro da meta; estouradas sem resposta contam como falha', async () => {
    const prisma = prismaWith([
      answered('a', 5),
      answered('a', 10),
      answered('b', 20, true),
      breachedOpen('b'),
    ]);

    expect(await responseSlaCompliance(prisma as any, 'org1', range)).toBe(50);
  });

  it('filtra por atendente quando escopado e consulta só esperas que contam', async () => {
    const prisma = prismaWith([answered('a', 5)]);

    await responseSlaCompliance(prisma as any, 'org1', range, 'a');

    expect(prisma.responseSlaRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org1',
          agentId: 'a',
          waitingSince: { gte: range.from, lte: range.to },
          OR: [{ respondedAt: { not: null } }, { breached: true }],
        }),
      }),
    );
  });

  it('sem esperas no período devolve null (painel mostra —)', async () => {
    expect(await responseSlaCompliance(prismaWith([]) as any, 'org1', range)).toBeNull();
  });
});

describe('responseSlaDailySeries', () => {
  it('um ponto por dia, 0 quando não houve espera', async () => {
    const prisma = prismaWith([
      answered('a', 5, false, '2026-11-09'),
      answered('a', 30, true, '2026-11-09'),
      answered('a', 5, false, '2026-11-10'),
    ]);

    const series = await responseSlaDailySeries(
      prisma as any, 'org1', range, ['2026-11-08', '2026-11-09', '2026-11-10'],
    );

    expect(series).toEqual([
      { date: '2026-11-08', value: 0 },
      { date: '2026-11-09', value: 50 },
      { date: '2026-11-10', value: 100 },
    ]);
  });
});

describe('responseSlaByAgent', () => {
  it('média de minutos úteis e % por atendente', async () => {
    const prisma = prismaWith([
      answered('a', 4),
      answered('a', 10),
      answered('b', 30, true),
      breachedOpen('b'),
      breachedOpen(null),
    ]);

    const byAgent = await responseSlaByAgent(prisma as any, 'org1', range);

    expect(byAgent.get('a')).toEqual({ avgBusinessResponseMinutes: 7, responseSlaPercent: 100 });
    expect(byAgent.get('b')).toEqual({ avgBusinessResponseMinutes: 30, responseSlaPercent: 0 });
    expect(byAgent.size).toBe(2);
  });
});
