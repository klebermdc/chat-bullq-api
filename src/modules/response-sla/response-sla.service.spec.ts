import { ResponseSlaService } from './response-sla.service';
import type { SlaContext, SlaRecord } from './response-sla.types';
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

function ctx(patch: Partial<SlaContext> = {}): SlaContext {
  return {
    conversationId: 'c1',
    organizationId: 'org1',
    assignedToId: 'agent1',
    contactName: 'Ana',
    isWaiting: true,
    slaMinutes: 15,
    tz: TZ,
    hours: WEEKDAYS,
    ...patch,
  };
}

function record(patch: Partial<SlaRecord> = {}): SlaRecord {
  return {
    id: 'r1',
    organizationId: 'org1',
    conversationId: 'c1',
    agentId: 'agent1',
    slaMinutes: 15,
    waitingSince: sp('2026-11-09T10:00:00'),
    dueAt: sp('2026-11-09T10:15:00'),
    warnedAt: null,
    breached: false,
    respondedAt: null,
    endedAt: null,
    ...patch,
  };
}

function setup() {
  const repository = {
    loadContext: jest.fn().mockResolvedValue(ctx()),
    findOpenRecord: jest.fn().mockResolvedValue(null),
    createRecord: jest.fn().mockImplementation(async (d) => record({ ...d, id: 'r1' })),
    updatePlan: jest.fn().mockResolvedValue(undefined),
    closeAnswered: jest.fn().mockResolvedValue(undefined),
    closeEnded: jest.fn().mockResolvedValue(undefined),
  };
  const scheduler = { scheduleOpenStages: jest.fn().mockResolvedValue(undefined) };
  const service = new ResponseSlaService(repository as any, scheduler as any);
  return { service, repository, scheduler };
}

describe('ResponseSlaService.onCustomerWaiting', () => {
  const at = sp('2026-11-09T23:00:00');

  it('abre a espera com prazo em minutos úteis do dono e agenda as etapas', async () => {
    const { service, repository, scheduler } = setup();

    await service.onCustomerWaiting('c1', at);

    expect(repository.createRecord).toHaveBeenCalledWith({
      organizationId: 'org1',
      conversationId: 'c1',
      agentId: 'agent1',
      slaMinutes: 15,
      waitingSince: at,
      dueAt: sp('2026-11-10T09:15:00'),
    });
    expect(scheduler.scheduleOpenStages).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1' }),
      { warnAt: sp('2026-11-10T09:07:30'), dueAt: sp('2026-11-10T09:15:00') },
      at,
    );
  });

  it('não faz nada quando a org não ligou o SLA', async () => {
    const { service, repository } = setup();
    repository.loadContext.mockResolvedValue(ctx({ slaMinutes: null }));

    await service.onCustomerWaiting('c1', at);

    expect(repository.createRecord).not.toHaveBeenCalled();
  });

  it('não faz nada quando a conversa não está no Esperando', async () => {
    const { service, repository } = setup();
    repository.loadContext.mockResolvedValue(ctx({ isWaiting: false }));

    await service.onCustomerWaiting('c1', at);

    expect(repository.createRecord).not.toHaveBeenCalled();
  });

  it('mensagem seguida do cliente não reinicia o relógio', async () => {
    const { service, repository } = setup();
    repository.findOpenRecord.mockResolvedValue(record());

    await service.onCustomerWaiting('c1', at);

    expect(repository.createRecord).not.toHaveBeenCalled();
  });

  it('não começa enquanto a IA está no comando', async () => {
    const { service, repository } = setup();
    const isAiInCharge = jest.fn().mockResolvedValue(true);

    await service.onCustomerWaiting('c1', at, isAiInCharge);

    expect(isAiInCharge).toHaveBeenCalled();
    expect(repository.createRecord).not.toHaveBeenCalled();
  });

  it('não agenda quando outra chamada abriu a espera primeiro', async () => {
    const { service, repository, scheduler } = setup();
    repository.createRecord.mockResolvedValue(null);

    await service.onCustomerWaiting('c1', at);

    expect(scheduler.scheduleOpenStages).not.toHaveBeenCalled();
  });

  it('nunca derruba quem chamou', async () => {
    const { service, repository } = setup();
    repository.loadContext.mockRejectedValue(new Error('db fora'));

    await expect(service.onCustomerWaiting('c1', at)).resolves.toBeUndefined();
  });
});

describe('ResponseSlaService.onHumanReply', () => {
  it('fecha com minutos úteis dentro da meta', async () => {
    const { service, repository } = setup();
    repository.findOpenRecord.mockResolvedValue(
      record({ waitingSince: sp('2026-11-09T23:00:00') }),
    );

    await service.onHumanReply('c1', sp('2026-11-10T09:10:00'));

    expect(repository.closeAnswered).toHaveBeenCalledWith('r1', {
      respondedAt: sp('2026-11-10T09:10:00'),
      businessMinutes: 10,
      breached: false,
      agentId: 'agent1',
    });
  });

  it('marca estouro quando passou da meta, mesmo sem o job ter rodado', async () => {
    const { service, repository } = setup();
    repository.findOpenRecord.mockResolvedValue(record());

    await service.onHumanReply('c1', sp('2026-11-09T10:20:00'));

    expect(repository.closeAnswered).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ businessMinutes: 20, breached: true }),
    );
  });

  it('sem espera aberta não faz nada', async () => {
    const { service, repository } = setup();

    await service.onHumanReply('c1', sp('2026-11-09T10:20:00'));

    expect(repository.closeAnswered).not.toHaveBeenCalled();
  });
});

describe('ResponseSlaService.onOwnerChanged', () => {
  it('recalcula o prazo desde o início da espera com o horário do novo dono', async () => {
    const { service, repository, scheduler } = setup();
    repository.findOpenRecord.mockResolvedValue(record());
    repository.loadContext.mockResolvedValue(ctx({ assignedToId: 'marcella', hours: MARCELLA }));
    const now = sp('2026-11-09T10:05:00');

    await service.onOwnerChanged('c1', now);

    expect(repository.updatePlan).toHaveBeenCalledWith('r1', {
      agentId: 'marcella',
      dueAt: sp('2026-11-09T14:15:00'),
    });
    expect(scheduler.scheduleOpenStages).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1' }),
      { warnAt: sp('2026-11-09T14:07:30'), dueAt: sp('2026-11-09T14:15:00') },
      now,
    );
  });

  it('sem espera aberta e conversa no Esperando: começa agora', async () => {
    const { service, repository } = setup();
    const now = sp('2026-11-09T10:05:00');

    await service.onOwnerChanged('c1', now);

    expect(repository.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({ waitingSince: now, agentId: 'agent1' }),
    );
  });
});

describe('ResponseSlaService.onWaitEnded', () => {
  it('fecha a espera aberta com o motivo', async () => {
    const { service, repository } = setup();
    repository.findOpenRecord.mockResolvedValue(record());
    const at = sp('2026-11-09T10:05:00');

    await service.onWaitEnded('c1', 'closed', at);

    expect(repository.closeEnded).toHaveBeenCalledWith('r1', 'closed', at);
  });
});
