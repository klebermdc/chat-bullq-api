import { TeamPresenceService } from './team-presence.service';

// Terça 22/09/2026, 20:00 em São Paulo.
const NOW = new Date('2026-09-22T23:00:00Z');
const RANGE = { from: new Date('2026-09-16T03:00:00Z'), to: NOW };
const WEEKDAYS_9_18 = Object.fromEntries(
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((d) => [
    d,
    { enabled: true, windows: [['09:00', '18:00']] },
  ]),
);
const ALWAYS_OPEN = Object.fromEntries(
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [
    d,
    { enabled: true, windows: [['00:00', '23:59']] },
  ]),
);

function make(opts: { sockets?: unknown[] } = {}) {
  const prisma = {
    userOrganization: {
      findMany: jest.fn().mockResolvedValue([
        { userId: 'pedro', role: 'AGENT', workingHours: WEEKDAYS_9_18, offHoursNoticeEnabled: true, user: { name: 'Pedro' } },
        { userId: 'marcella', role: 'AGENT', workingHours: ALWAYS_OPEN, offHoursNoticeEnabled: true, user: { name: 'Marcella' } },
        { userId: 'renata', role: 'OWNER', workingHours: null, offHoursNoticeEnabled: false, user: { name: 'Renata' } },
      ]),
    },
    organization: { findUnique: jest.fn().mockResolvedValue({ aiTimezone: 'America/Sao_Paulo' }) },
    conversation: {
      groupBy: jest
        .fn()
        // 1ª chamada: esperando resposta; 2ª: última resposta humana.
        .mockResolvedValueOnce([{ assignedToId: 'pedro', _count: { _all: 3 } }])
        .mockResolvedValueOnce([
          { assignedToId: 'pedro', _max: { lastHumanReplyAt: new Date('2026-09-22T20:40:00Z') } },
        ]),
    },
    agentPresenceDaily: {
      findMany: jest.fn().mockResolvedValue([
        { userId: 'marcella', day: new Date('2026-09-22T00:00:00Z'), onlineMinutes: 300, activeMinutes: 240, firstSeenAt: new Date('2026-09-22T17:02:00Z') },
        { userId: 'marcella', day: new Date('2026-09-21T00:00:00Z'), onlineMinutes: 480, activeMinutes: 400, firstSeenAt: new Date('2026-09-21T17:00:00Z') },
      ]),
    },
  } as any;
  const realtime = {
    listSocketPresence: jest.fn().mockResolvedValue(
      opts.sockets ?? [
        { organizationId: 'org-1', userId: 'marcella', lastActiveAt: new Date(NOW.getTime() - 60_000) },
        { organizationId: 'org-2', userId: 'pedro', lastActiveAt: NOW },
      ],
    ),
  } as any;
  const service = new TeamPresenceService(prisma, realtime);
  (service as any).clock = () => NOW;
  return { service, prisma };
}

describe('TeamPresenceService.getTeamPresence', () => {
  it('monta uma linha por atendente com status, horário, fila e tempo online', async () => {
    const { service } = make();

    const rows = await service.getTeamPresence('org-1', RANGE);

    const marcella = rows.find((r) => r.userId === 'marcella')!;
    expect(marcella).toMatchObject({
      name: 'Marcella',
      status: 'online',
      schedule: { configured: true, withinHours: true, onCall: false },
      waitingCount: 0,
      today: { onlineMinutes: 300, activeMinutes: 240 },
      period: { onlineMinutes: 780, activeMinutes: 640, daysOnline: 2 },
    });

    const pedro = rows.find((r) => r.userId === 'pedro')!;
    expect(pedro).toMatchObject({
      // Conectado em OUTRA org: aqui ele está offline.
      status: 'offline',
      schedule: { configured: true, withinHours: false, onCall: true },
      waitingCount: 3,
      lastHumanReplyAt: '2026-09-22T20:40:00.000Z',
      today: { onlineMinutes: 0, activeMinutes: 0, firstSeenAt: null },
    });
    expect(pedro.schedule.returnsAt).toEqual(expect.stringContaining('9'));

    const renata = rows.find((r) => r.userId === 'renata')!;
    expect(renata.schedule).toEqual({ configured: false, withinHours: null, returnsAt: null, onCall: false });
  });

  it('ordena online primeiro, depois ausente, depois offline', async () => {
    const { service } = make({
      sockets: [
        { organizationId: 'org-1', userId: 'renata', lastActiveAt: new Date(NOW.getTime() - 30 * 60_000) },
        { organizationId: 'org-1', userId: 'marcella', lastActiveAt: NOW },
      ],
    });

    const rows = await service.getTeamPresence('org-1', RANGE);

    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ['Marcella', 'online'],
      ['Renata', 'away'],
      ['Pedro', 'offline'],
    ]);
  });

  it('atendente (AGENT) vê só a própria linha', async () => {
    const { service, prisma } = make();

    await service.getTeamPresence('org-1', RANGE, 'pedro');

    expect(prisma.userOrganization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1', userId: 'pedro' }),
      }),
    );
  });
});
