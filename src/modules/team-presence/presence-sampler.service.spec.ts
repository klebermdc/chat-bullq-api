import { PresenceSamplerService } from './presence-sampler.service';

// 13:00 em São Paulo.
const NOW = new Date('2026-09-22T16:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function make(sockets: unknown[]) {
  const prisma = {
    organization: {
      findMany: jest.fn().mockResolvedValue([{ id: 'org-1', aiTimezone: 'America/Sao_Paulo' }]),
    },
    agentPresenceDaily: { upsert: jest.fn().mockResolvedValue({}) },
  } as any;
  const realtime = { listSocketPresence: jest.fn().mockResolvedValue(sockets) } as any;
  return { sampler: new PresenceSamplerService(prisma, realtime), prisma };
}

describe('PresenceSamplerService.sample', () => {
  it('soma 1 minuto online e 1 ativo para quem mexeu no Chat agora', async () => {
    const { sampler, prisma } = make([
      { organizationId: 'org-1', userId: 'pedro', lastActiveAt: minutesAgo(1) },
    ]);

    await sampler.sample(NOW);

    expect(prisma.agentPresenceDaily.upsert).toHaveBeenCalledWith({
      where: {
        organizationId_userId_day: {
          organizationId: 'org-1',
          userId: 'pedro',
          day: new Date('2026-09-22T00:00:00Z'),
        },
      },
      create: {
        organizationId: 'org-1',
        userId: 'pedro',
        day: new Date('2026-09-22T00:00:00Z'),
        onlineMinutes: 1,
        activeMinutes: 1,
        firstSeenAt: NOW,
        lastSeenAt: NOW,
      },
      update: {
        onlineMinutes: { increment: 1 },
        activeMinutes: { increment: 1 },
        lastSeenAt: NOW,
      },
    });
  });

  it('Chat aberto e parado conta como online, mas não como ativo', async () => {
    const { sampler, prisma } = make([
      { organizationId: 'org-1', userId: 'pedro', lastActiveAt: minutesAgo(40) },
    ]);

    await sampler.sample(NOW);

    const { update } = prisma.agentPresenceDaily.upsert.mock.calls[0][0];
    expect(update.activeMinutes).toEqual({ increment: 0 });
    expect(update.onlineMinutes).toEqual({ increment: 1 });
  });

  it('duas abas do mesmo atendente contam um minuto só', async () => {
    const { sampler, prisma } = make([
      { organizationId: 'org-1', userId: 'pedro', lastActiveAt: minutesAgo(1) },
      { organizationId: 'org-1', userId: 'pedro', lastActiveAt: minutesAgo(20) },
    ]);

    await sampler.sample(NOW);

    expect(prisma.agentPresenceDaily.upsert).toHaveBeenCalledTimes(1);
  });

  it('ninguém conectado: não grava nada', async () => {
    const { sampler, prisma } = make([]);

    await sampler.sample(NOW);

    expect(prisma.organization.findMany).not.toHaveBeenCalled();
    expect(prisma.agentPresenceDaily.upsert).not.toHaveBeenCalled();
  });

  it('falha de um atendente não impede os outros', async () => {
    const { sampler, prisma } = make([
      { organizationId: 'org-1', userId: 'pedro', lastActiveAt: NOW },
      { organizationId: 'org-1', userId: 'renata', lastActiveAt: NOW },
    ]);
    prisma.agentPresenceDaily.upsert.mockRejectedValueOnce(new Error('db blip'));

    await sampler.sample(NOW);

    expect(prisma.agentPresenceDaily.upsert).toHaveBeenCalledTimes(2);
  });
});
