import { ResponseSlaStageHandler } from './response-sla-stage.handler';
import type { SlaContext, SlaRecord, StageJobData } from './response-sla.types';
import type { BusinessHoursConfig } from '../routing/availability/business-hours.util';

const TZ = 'America/Sao_Paulo';
const sp = (isoLocal: string) => new Date(`${isoLocal}-03:00`);
const WEEKDAYS: BusinessHoursConfig = {
  monday: { enabled: true, windows: [['09:00', '18:00']] },
  tuesday: { enabled: true, windows: [['09:00', '18:00']] },
};
const MARCELLA: BusinessHoursConfig = {
  monday: { enabled: true, windows: [['14:00', '22:00']] },
};
const SINCE = sp('2026-11-09T10:00:00');

const ctx = (patch: Partial<SlaContext> = {}): SlaContext => ({
  conversationId: 'c1',
  organizationId: 'org1',
  assignedToId: 'agent1',
  contactName: 'Ana',
  isWaiting: true,
  slaMinutes: 15,
  tz: TZ,
  hours: WEEKDAYS,
  ...patch,
});

const record = (patch: Partial<SlaRecord> = {}): SlaRecord => ({
  id: 'r1',
  organizationId: 'org1',
  conversationId: 'c1',
  agentId: 'agent1',
  slaMinutes: 15,
  waitingSince: SINCE,
  dueAt: sp('2026-11-09T10:15:00'),
  warnedAt: null,
  breached: false,
  respondedAt: null,
  endedAt: null,
  ...patch,
});

const job = (stage: 'warn' | 'breach'): StageJobData => ({
  recordId: 'r1',
  conversationId: 'c1',
  waitingSince: SINCE.getTime(),
  stage,
});

function setup() {
  const repository = {
    findRecord: jest.fn().mockResolvedValue(record()),
    loadContext: jest.fn().mockResolvedValue(ctx()),
    claimWarn: jest.fn().mockResolvedValue(true),
    claimBreach: jest.fn().mockResolvedValue(true),
    updatePlan: jest.fn().mockResolvedValue(undefined),
    closeEnded: jest.fn().mockResolvedValue(undefined),
    closeAnswered: jest.fn().mockResolvedValue(undefined),
    findStaleOpenRecords: jest.fn().mockResolvedValue([]),
  };
  const scheduler = { schedule: jest.fn().mockResolvedValue(undefined) };
  const notifier = {
    warn: jest.fn().mockResolvedValue(undefined),
    breach: jest.fn().mockResolvedValue(undefined),
  };
  const sla = { onHumanReply: jest.fn().mockResolvedValue(undefined) };
  const handler = new ResponseSlaStageHandler(
    repository as any,
    scheduler as any,
    notifier as any,
    sla as any,
  );
  return { handler, repository, scheduler, notifier, sla };
}

describe('ResponseSlaStageHandler.handle', () => {
  it('na metade do prazo avisa só o dono', async () => {
    const { handler, repository, notifier } = setup();

    const out = await handler.handle(job('warn'), sp('2026-11-09T10:07:30'));

    expect(out).toBe('notified');
    expect(repository.claimWarn).toHaveBeenCalledWith('r1', sp('2026-11-09T10:07:30'));
    expect(notifier.warn).toHaveBeenCalledWith(ctx(), record(), 8);
    expect(notifier.breach).not.toHaveBeenCalled();
  });

  it('no prazo dispara o estouro', async () => {
    const { handler, notifier } = setup();

    const out = await handler.handle(job('breach'), sp('2026-11-09T10:15:00'));

    expect(out).toBe('notified');
    expect(notifier.breach).toHaveBeenCalledWith(ctx(), record(), 15);
  });

  it('job repetido não avisa de novo (outra chamada já marcou)', async () => {
    const { handler, repository, notifier } = setup();
    repository.claimBreach.mockResolvedValue(false);

    const out = await handler.handle(job('breach'), sp('2026-11-09T10:15:00'));

    expect(out).toBe('skip:already_done');
    expect(notifier.breach).not.toHaveBeenCalled();
  });

  it('espera já respondida é no-op', async () => {
    const { handler, notifier, repository } = setup();
    repository.findRecord.mockResolvedValue(record({ respondedAt: sp('2026-11-09T10:05:00') }));

    const out = await handler.handle(job('breach'), sp('2026-11-09T10:15:00'));

    expect(out).toBe('skip:closed');
    expect(repository.loadContext).not.toHaveBeenCalled();
    expect(notifier.breach).not.toHaveBeenCalled();
  });

  it('job de outra espera (início diferente) é no-op', async () => {
    const { handler, repository } = setup();
    repository.findRecord.mockResolvedValue(record({ waitingSince: sp('2026-11-09T11:00:00') }));

    const out = await handler.handle(job('breach'), sp('2026-11-09T10:15:00'));

    expect(out).toBe('skip:stale');
  });

  it('aviso atrasado depois do estouro não sai', async () => {
    const { handler, repository, notifier } = setup();
    repository.findRecord.mockResolvedValue(record({ breached: true }));

    const out = await handler.handle(job('warn'), sp('2026-11-09T10:20:00'));

    expect(out).toBe('skip:already_done');
    expect(notifier.warn).not.toHaveBeenCalled();
  });

  it('conversa saiu do Esperando por caminho sem gancho: encerra a espera', async () => {
    const { handler, repository, notifier } = setup();
    repository.loadContext.mockResolvedValue(ctx({ isWaiting: false }));
    const now = sp('2026-11-09T10:15:00');

    const out = await handler.handle(job('breach'), now);

    expect(out).toBe('skip:not_waiting');
    expect(repository.closeEnded).toHaveBeenCalledWith('r1', 'not_waiting', now);
    expect(notifier.breach).not.toHaveBeenCalled();
  });

  it('org desligou o SLA no meio: encerra sem avisar', async () => {
    const { handler, repository, notifier } = setup();
    repository.loadContext.mockResolvedValue(ctx({ slaMinutes: null }));
    const now = sp('2026-11-09T10:15:00');

    await handler.handle(job('breach'), now);

    expect(repository.closeEnded).toHaveBeenCalledWith('r1', 'sla_disabled', now);
    expect(notifier.breach).not.toHaveBeenCalled();
  });

  it('dono mudou para alguém que ainda não entrou: reagenda, não avisa', async () => {
    const { handler, repository, scheduler, notifier } = setup();
    repository.loadContext.mockResolvedValue(ctx({ assignedToId: 'marcella', hours: MARCELLA }));
    const now = sp('2026-11-09T10:15:00');

    const out = await handler.handle(job('breach'), now);

    expect(out).toBe('rescheduled');
    expect(scheduler.schedule).toHaveBeenCalledWith(
      record(), 'breach', sp('2026-11-09T14:15:00'), now,
    );
    expect(repository.updatePlan).toHaveBeenCalledWith('r1', {
      agentId: 'marcella',
      dueAt: sp('2026-11-09T14:15:00'),
    });
    expect(notifier.breach).not.toHaveBeenCalled();
  });

  it('job atrasado que caiu fora do expediente adia para a abertura', async () => {
    const { handler, scheduler, notifier } = setup();
    const now = sp('2026-11-09T19:00:00'); // segunda já fechou

    const out = await handler.handle(job('breach'), now);

    expect(out).toBe('deferred');
    expect(scheduler.schedule).toHaveBeenCalledWith(
      record(), 'breach', sp('2026-11-10T09:00:00'), now,
    );
    expect(notifier.breach).not.toHaveBeenCalled();
  });

  it('agenda sem janelas: sem prazo, sem aviso', async () => {
    const { handler, repository, notifier } = setup();
    repository.loadContext.mockResolvedValue(ctx({ hours: { monday: { enabled: false } } }));

    const out = await handler.handle(job('breach'), sp('2026-11-09T10:15:00'));

    expect(out).toBe('skip:no_hours');
    expect(notifier.breach).not.toHaveBeenCalled();
  });
});

describe('ResponseSlaStageHandler.reconcile', () => {
  it('humano respondeu por caminho sem gancho: fecha como respondida', async () => {
    const { handler, repository, sla } = setup();
    repository.findStaleOpenRecords.mockResolvedValue([
      {
        id: 'r1',
        conversationId: 'c1',
        waitingSince: SINCE,
        lastHumanReplyAt: sp('2026-11-09T10:04:00'),
      },
    ]);

    await handler.reconcile(sp('2026-11-09T10:30:00'));

    expect(sla.onHumanReply).toHaveBeenCalledWith('c1', sp('2026-11-09T10:04:00'));
    expect(repository.closeEnded).not.toHaveBeenCalled();
  });

  it('saiu do Esperando sem resposta: encerra', async () => {
    const { handler, repository, sla } = setup();
    repository.findStaleOpenRecords.mockResolvedValue([
      { id: 'r1', conversationId: 'c1', waitingSince: SINCE, lastHumanReplyAt: null },
    ]);
    const now = sp('2026-11-09T10:30:00');

    await handler.reconcile(now);

    expect(repository.closeEnded).toHaveBeenCalledWith('r1', 'reconcile', now);
    expect(sla.onHumanReply).not.toHaveBeenCalled();
  });
});
