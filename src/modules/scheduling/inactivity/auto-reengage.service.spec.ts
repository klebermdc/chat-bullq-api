import { AutoReengageService } from './auto-reengage.service';

function makeDeps(opts: { pending?: any[]; sender?: string | null; draft?: string | null } = {}) {
  const schedRepo = {
    findPending: jest.fn(async () => opts.pending ?? []),
    create: jest.fn(async (d: any) => ({ id: 's1', ...d })),
    update: jest.fn(async () => ({})),
  };
  const inactivityRepo = {
    resolveSystemSender: jest.fn(async () => (opts.sender === undefined ? 'u1' : opts.sender)),
    markReengaged: jest.fn(async () => ({})),
    orgTimezone: jest.fn(async () => 'America/Sao_Paulo'),
  };
  const draftService = { draft: jest.fn(async () => (opts.draft === undefined ? 'Oi!' : opts.draft)) };
  const queue = { add: jest.fn(async () => ({ id: 'job1' })) };
  const service = new AutoReengageService(
    schedRepo as any,
    inactivityRepo as any,
    draftService as any,
    queue as any,
  );
  return { service, schedRepo, queue, inactivityRepo };
}

const cfg: any = {
  maxAttempts: 2,
  retryEveryHours: 48,
  quietHoursStart: null,
  quietHoursEnd: null,
  reengageFromBand: 1,
};

describe('AutoReengageService.maybeCreate', () => {
  const conv = {
    id: 'c1',
    assignedToId: null,
    reengageDismissedAt: null,
    reengagedAt: null,
    contactId: 'ct1',
    channelId: 'ch1',
  };

  it('cria agendamento AUTO_REENGAGE quando elegível', async () => {
    const { service, schedRepo, queue, inactivityRepo } = makeDeps();
    await service.maybeCreate('org1', conv, 2, cfg);
    expect(schedRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'AUTO_REENGAGE',
        content: { text: 'Oi!' },
        contactId: 'ct1',
        channelId: 'ch1',
        createdById: 'u1',
        attempt: 1,
        maxAttempts: 2,
        retryEveryHours: 48,
      }),
    );
    expect(queue.add).toHaveBeenCalled();
    expect(schedRepo.update).toHaveBeenCalledWith('s1', { jobId: 'job1' });
    // Marca a conversa como já reengajada nesta streak.
    expect(inactivityRepo.markReengaged).toHaveBeenCalledWith('c1');
  });

  it('pula quando já reengajado nesta streak (reengagedAt setado)', async () => {
    const { service, schedRepo, inactivityRepo } = makeDeps();
    await service.maybeCreate('org1', { ...conv, reengagedAt: new Date() }, 2, cfg);
    expect(schedRepo.create).not.toHaveBeenCalled();
    expect(inactivityRepo.markReengaged).not.toHaveBeenCalled();
  });

  it('pula quando já há pendente', async () => {
    const { service, schedRepo } = makeDeps({ pending: [{ id: 'x' }] });
    await service.maybeCreate('org1', conv, 2, cfg);
    expect(schedRepo.create).not.toHaveBeenCalled();
  });

  it('pula quando descartado', async () => {
    const { service, schedRepo } = makeDeps();
    await service.maybeCreate('org1', { ...conv, reengageDismissedAt: new Date() }, 2, cfg);
    expect(schedRepo.create).not.toHaveBeenCalled();
  });

  it('pula quando sem sender resolvível', async () => {
    const { service, schedRepo } = makeDeps({ sender: null });
    await service.maybeCreate('org1', conv, 2, cfg);
    expect(schedRepo.create).not.toHaveBeenCalled();
  });

  it('pula quando sem rascunho', async () => {
    const { service, schedRepo } = makeDeps({ draft: null });
    await service.maybeCreate('org1', conv, 2, cfg);
    expect(schedRepo.create).not.toHaveBeenCalled();
  });
});

describe('AutoReengageService.nextAllowedTime', () => {
  const TZ = 'America/Sao_Paulo'; // UTC-3, sem DST nesta data
  const hourInTz = (d: Date) =>
    parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        hour: 'numeric',
        hour12: false,
      }).format(d) === '24'
        ? '0'
        : new Intl.DateTimeFormat('en-US', {
            timeZone: TZ,
            hour: 'numeric',
            hour12: false,
          }).format(d),
      10,
    );

  it('sem quiet hours retorna now', () => {
    const { service } = makeDeps();
    const now = new Date('2026-01-01T03:00:00Z');
    expect(service.nextAllowedTime(now, null, null, TZ)).toBe(now);
  });

  it('dentro do quiet window (no fuso) empurra para o endHour naquele fuso', () => {
    const { service } = makeDeps();
    // 02:00Z = 23:00 em Sao_Paulo (UTC-3) → dentro de quiet 22->8 → empurra pro 8h local
    const now = new Date('2026-01-01T02:00:00Z');
    expect(hourInTz(now)).toBe(23);
    const at = service.nextAllowedTime(now, 22, 8, TZ);
    expect(at.getTime()).toBeGreaterThan(now.getTime());
    expect(hourInTz(at)).toBe(8);
  });

  it('fora do quiet window (no fuso) retorna now', () => {
    const { service } = makeDeps();
    // 15:00Z = 12:00 em Sao_Paulo → fora de quiet 22->8 → now
    const now = new Date('2026-01-01T15:00:00Z');
    expect(hourInTz(now)).toBe(12);
    expect(service.nextAllowedTime(now, 22, 8, TZ)).toBe(now);
  });
});
