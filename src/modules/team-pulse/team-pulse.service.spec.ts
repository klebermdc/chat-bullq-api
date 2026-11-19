import { BadRequestException } from '@nestjs/common';
import { TeamPulseService } from './team-pulse.service';

const sp = (isoLocal: string) => new Date(`${isoLocal}-03:00`);
const iso = (isoLocal: string) => sp(isoLocal).toISOString();
const CHANNEL = { id: 'ch1' };
const SETTINGS = {
  teamPulse: { channelId: 'ch1', recipients: [{ name: 'Renata Dias', phone: '5511947156251' }] },
};
const ORG = { id: 'org1', settings: SETTINGS, tz: 'America/Sao_Paulo', orgHours: null };
const AT_15H = sp('2026-11-19T15:00:00');
const AT_22H = sp('2026-11-19T22:00:00');

const PEDRO = {
  name: 'Pedro Souza',
  status: 'online',
  lastActiveAt: iso('2026-11-19T14:59:00'),
  schedule: { configured: true, withinHours: true },
  today: { firstSeenAt: iso('2026-11-19T09:02:00') },
  period: {
    days: [
      {
        day: '2026-11-19',
        firstSeenAt: iso('2026-11-19T09:02:00'),
        lastActiveAt: iso('2026-11-19T18:11:00'),
        lastSeenAt: iso('2026-11-19T18:15:00'),
        onlineMinutes: 500,
        activeMinutes: 425,
      },
    ],
  },
};
const BARBARA = {
  name: 'Bárbara',
  status: 'offline',
  lastActiveAt: null,
  schedule: { configured: true, withinHours: false },
  today: { firstSeenAt: null },
  period: { days: [] },
};

interface SetupOptions {
  orgs?: unknown[];
  team?: unknown[];
  claim?: boolean;
  settings?: unknown;
  sendOk?: boolean;
}

function setup(over: SetupOptions = {}) {
  const alerts = {
    listActiveOrgs: jest.fn().mockResolvedValue(over.orgs ?? [{ ...ORG, settings: over.settings ?? SETTINGS }]),
    findOrg: jest.fn().mockResolvedValue({ ...ORG, settings: over.settings ?? SETTINGS }),
    findChannel: jest.fn().mockResolvedValue(CHANNEL),
    listOpenWaits: jest
      .fn()
      .mockResolvedValue([{ contactName: 'Maria', agentName: 'Pedro Souza', waitingSince: sp('2026-11-19T14:12:00'), hours: null }]),
  };
  const repository = {
    listBreaches: jest.fn().mockResolvedValue([{ agentName: null }]),
    countLeads: jest.fn().mockResolvedValue({ total: 7, withAi: 4, inQueue: 3 }),
  };
  const presence = { getTeamPresence: jest.fn().mockResolvedValue(over.team ?? [PEDRO, BARBARA]) };
  const sender = {
    sendToAll: jest.fn(async (_c, recipients, _t, paramsFor) =>
      recipients.map((r: { phone: string }) => ({
        phone: r.phone,
        ok: over.sendOk ?? true,
        ...(over.sendOk === false ? { error: 'template não aprovado' } : {}),
        params: paramsFor(r),
      })),
    ),
  };
  const errors = { report: jest.fn() };
  const throttle = { claimHour: jest.fn().mockResolvedValue(over.claim ?? true) };
  const service = new TeamPulseService(
    alerts as never,
    repository as never,
    presence as never,
    sender as never,
    errors as never,
    throttle as never,
  );
  return { service, alerts, repository, presence, sender, errors, throttle };
}

const sentParams = (sender: { sendToAll: jest.Mock }, call = 0) =>
  sender.sendToAll.mock.calls[call][3]({ name: 'Renata Dias', phone: '5511947156251' });

describe('TeamPulseService.runTick — pulso por hora', () => {
  it('manda o pulso às 15h listando só quem está no horário', async () => {
    // Arrange
    const { service, sender, throttle, repository } = setup();
    // Act
    await service.runTick(AT_15H);
    // Assert
    expect(throttle.claimHour).toHaveBeenCalledWith('org1', '2026-11-19', 15);
    expect(sender.sendToAll).toHaveBeenCalledTimes(1);
    expect(sender.sendToAll.mock.calls[0][2]).toEqual({ name: 'pulso_atendimento', language: 'pt_BR' });
    expect(sentParams(sender)).toEqual([
      '15h · qui 19/11',
      '1 online',
      'Pedro (desde 09:02)',
      'nenhum',
      '1 (Pedro 1)',
      '48 min (Pedro)',
      '1 (sem dono 1)',
      '7 (4 com a Aline · 3 na fila)',
    ]);
    const lastHour = { from: sp('2026-11-19T14:00:00'), to: AT_15H };
    expect(repository.listBreaches).toHaveBeenCalledWith('org1', lastHour);
    expect(repository.countLeads).toHaveBeenCalledWith('org1', lastHour);
  });

  it('não manda (nem gasta a trava) quando ninguém está no horário', async () => {
    const { service, sender, throttle, alerts } = setup({ team: [BARBARA] });
    await service.runTick(AT_15H);
    expect(throttle.claimHour).not.toHaveBeenCalled();
    expect(alerts.listOpenWaits).not.toHaveBeenCalled();
    expect(sender.sendToAll).not.toHaveBeenCalled();
  });

  it('não manda duas vezes na mesma hora (trava ocupada)', async () => {
    const { service, sender } = setup({ claim: false });
    await service.runTick(AT_15H);
    expect(sender.sendToAll).not.toHaveBeenCalled();
  });

  it('não faz nada depois do fechamento', async () => {
    const { service, sender, presence } = setup();
    await service.runTick(sp('2026-11-19T23:00:00'));
    expect(presence.getTeamPresence).not.toHaveBeenCalled();
    expect(sender.sendToAll).not.toHaveBeenCalled();
  });

  it('org sem teamPulse fica de fora', async () => {
    const { service, presence } = setup({ settings: { responseSlaMinutes: 15 } });
    await service.runTick(AT_15H);
    expect(presence.getTeamPresence).not.toHaveBeenCalled();
  });
});

describe('TeamPulseService.runTick — fechamento', () => {
  it('às 22h manda o ponto do dia com os números do dia inteiro', async () => {
    const { service, sender, throttle, repository } = setup({ team: [PEDRO, BARBARA] });
    await service.runTick(AT_22H);
    expect(throttle.claimHour).toHaveBeenCalledWith('org1', '2026-11-19', 22);
    expect(sender.sendToAll.mock.calls[0][2]).toEqual({ name: 'fechamento_atendimento', language: 'pt_BR' });
    expect(sentParams(sender)).toEqual([
      'qui 19/11',
      'Pedro 09:02–18:11 (ativo 7h05)',
      '1 (Pedro 1)',
      '1 (sem dono 1)',
      '7',
    ]);
    const today = { from: sp('2026-11-19T00:00:00'), to: AT_22H };
    expect(repository.listBreaches).toHaveBeenCalledWith('org1', today);
    expect(repository.countLeads).toHaveBeenCalledWith('org1', today);
  });
});

describe('TeamPulseService.runTick — falhas', () => {
  it('a falha de uma org não impede a próxima e vai para o ErrorReporter', async () => {
    // Arrange
    const { service, presence, sender, errors } = setup({
      orgs: [
        { ...ORG, id: 'org-quebrada' },
        { ...ORG, id: 'org2' },
      ],
    });
    presence.getTeamPresence.mockRejectedValueOnce(new Error('socket fora'));
    // Act
    await service.runTick(AT_15H);
    // Assert
    expect(sender.sendToAll).toHaveBeenCalledTimes(1);
    expect(errors.report).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-quebrada', code: 'TEAM_PULSE_FAILED' }),
    );
  });

  it('destinatário que não recebeu vira aviso no ErrorReporter', async () => {
    const { service, errors } = setup({ sendOk: false });
    await service.runTick(AT_15H);
    expect(errors.report).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TEAM_PULSE_FAILED', severity: 'WARNING' }),
    );
  });

  it('canal não encontrado devolve erro por destinatário sem lançar', async () => {
    const { service, alerts, sender, errors } = setup();
    alerts.findChannel.mockResolvedValueOnce(null);
    await service.runTick(AT_15H);
    expect(sender.sendToAll).not.toHaveBeenCalled();
    expect(errors.report).toHaveBeenCalledTimes(1);
  });
});

describe('TeamPulseService.sendTest', () => {
  it('manda o pulso na hora, ignorando a hora e a trava', async () => {
    const { service, sender, throttle } = setup();
    const report = await service.sendTest('org1', 'hourly', sp('2026-11-19T23:30:00'));
    expect(throttle.claimHour).not.toHaveBeenCalled();
    expect(sender.sendToAll).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ kind: 'hourly', template: 'pulso_atendimento' });
  });

  it('manda o fechamento sob demanda', async () => {
    const { service, sender } = setup();
    const report = await service.sendTest('org1', 'closing', AT_15H);
    expect(sender.sendToAll.mock.calls[0][2].name).toBe('fechamento_atendimento');
    expect(report.kind).toBe('closing');
  });

  it('fechamento deixa de fora quem não tem horário de trabalho (admin que só olha o painel)', async () => {
    const admin = { ...PEDRO, userId: 'adm', name: 'Kleber Admin', schedule: { configured: false, withinHours: null } };
    const { service, sender } = setup({ team: [PEDRO, admin] as never });
    await service.sendTest('org1', 'closing', AT_15H);
    const [, recipients, , paramsFor] = sender.sendToAll.mock.calls[0];
    const clock = paramsFor(recipients[0]).join(' ');
    expect(clock).toContain('Pedro');
    expect(clock).not.toContain('Kleber');
  });

  it('recusa quando a org não tem teamPulse válido', async () => {
    const { service } = setup({ settings: { teamPulse: { channelId: '' } } });
    await expect(service.sendTest('org1', 'hourly', AT_15H)).rejects.toBeInstanceOf(BadRequestException);
  });
});
