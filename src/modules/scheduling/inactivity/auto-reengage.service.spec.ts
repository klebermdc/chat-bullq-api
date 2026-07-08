import { AutoReengageService } from './auto-reengage.service';

function makeDeps(opts: { pending?: any[]; sender?: string | null; draft?: string | null } = {}) {
  const schedRepo = {
    findPending: jest.fn(async () => opts.pending ?? []),
    create: jest.fn(async (d: any) => ({ id: 's1', ...d })),
    update: jest.fn(async () => ({})),
  };
  const inactivityRepo = {
    resolveSystemSender: jest.fn(async () => (opts.sender === undefined ? 'u1' : opts.sender)),
  };
  const draftService = { draft: jest.fn(async () => (opts.draft === undefined ? 'Oi!' : opts.draft)) };
  const queue = { add: jest.fn(async () => ({ id: 'job1' })) };
  const service = new AutoReengageService(
    schedRepo as any,
    inactivityRepo as any,
    draftService as any,
    queue as any,
  );
  return { service, schedRepo, queue };
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
    contactId: 'ct1',
    channelId: 'ch1',
  };

  it('cria agendamento AUTO_REENGAGE quando elegível', async () => {
    const { service, schedRepo, queue } = makeDeps();
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
  it('sem quiet hours retorna now', () => {
    const { service } = makeDeps();
    const now = new Date('2026-01-01T03:00:00');
    expect(service.nextAllowedTime(now, null, null)).toBe(now);
  });

  it('dentro do quiet window empurra para o endHour', () => {
    const { service } = makeDeps();
    const now = new Date('2026-01-01T23:00:00');
    // quiet 22->8 (cruza meia-noite): 23h está dentro → empurra pro dia seguinte 8h
    const at = service.nextAllowedTime(now, 22, 8);
    expect(at.getHours()).toBe(8);
    expect(at.getTime()).toBeGreaterThan(now.getTime());
  });

  it('fora do quiet window retorna now', () => {
    const { service } = makeDeps();
    const now = new Date('2026-01-01T12:00:00');
    expect(service.nextAllowedTime(now, 22, 8)).toBe(now);
  });
});
