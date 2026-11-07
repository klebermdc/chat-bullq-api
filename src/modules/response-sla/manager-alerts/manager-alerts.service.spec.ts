import { BadRequestException } from '@nestjs/common';
import { ManagerAlertsService } from './manager-alerts.service';

const sp = (isoLocal: string) => new Date(`${isoLocal}-03:00`);
const CHANNEL = { id: 'ch1' };
const SETTINGS = {
  responseSlaMinutes: 15,
  slaManagerAlerts: {
    channelId: 'ch1',
    recipients: [{ name: 'Renata Dias', phone: '5511947156251' }],
    digestAfterMinutes: 30,
    digestIntervalMinutes: 30,
    scoreboardTime: '22:10',
  },
};
const ORG = { id: 'org1', settings: SETTINGS, tz: 'America/Sao_Paulo', orgHours: null };
const OLD_WAIT = { contactName: 'Maria', agentName: 'Pedro', waitingSince: sp('2026-11-09T09:00:00'), hours: null };

function setup(over: { waits?: unknown[]; rows?: unknown[]; claim?: boolean; settings?: unknown } = {}) {
  const repository = {
    listActiveOrgs: jest.fn().mockResolvedValue([{ ...ORG, settings: over.settings ?? SETTINGS }]),
    findOrg: jest.fn().mockResolvedValue({ ...ORG, settings: over.settings ?? SETTINGS }),
    findChannel: jest.fn().mockResolvedValue(CHANNEL),
    listOpenWaits: jest.fn().mockResolvedValue(over.waits ?? [OLD_WAIT]),
    listCountedWaits: jest.fn().mockResolvedValue(over.rows ?? []),
  };
  const sender = {
    sendToAll: jest.fn(async (_c, recipients, _t, paramsFor) =>
      recipients.map((r: { phone: string }) => ({ phone: r.phone, ok: true, params: paramsFor(r) })),
    ),
  };
  const errors = { report: jest.fn() };
  const throttle = {
    claimDigest: jest.fn().mockResolvedValue(over.claim ?? true),
    claimScoreboard: jest.fn().mockResolvedValue(over.claim ?? true),
  };
  const service = new ManagerAlertsService(
    repository as never,
    sender as never,
    errors as never,
    throttle as never,
  );
  return { service, repository, sender, errors, throttle };
}

describe('ManagerAlertsService.runTick — resumo', () => {
  const tenAm = sp('2026-11-09T10:00:00');

  it('manda o resumo quando há espera acima do corte e a trava libera', async () => {
    const { service, sender, throttle } = setup();
    await service.runTick(tenAm);
    expect(throttle.claimDigest).toHaveBeenCalledWith('org1', 30);
    expect(sender.sendToAll).toHaveBeenCalledTimes(1);
    const params = sender.sendToAll.mock.calls[0][3]({ name: 'Renata Dias', phone: 'x' });
    expect(params).toEqual(['Renata', '1', 'Pedro 1', 'Maria com Pedro, 60 min']);
  });

  it('não manda com zero esperas (nem gasta a trava)', async () => {
    const { service, sender, throttle } = setup({ waits: [] });
    await service.runTick(tenAm);
    expect(throttle.claimDigest).not.toHaveBeenCalled();
    expect(sender.sendToAll).not.toHaveBeenCalled();
  });

  it('respeita a trava do intervalo', async () => {
    const { service, sender } = setup({ claim: false });
    await service.runTick(tenAm);
    expect(sender.sendToAll).not.toHaveBeenCalled();
  });

  it('fica quieto entre 22:30 e 08:00', async () => {
    const { service, sender, throttle } = setup({
      waits: [{ ...OLD_WAIT, waitingSince: sp('2026-11-09T20:00:00') }],
    });
    await service.runTick(sp('2026-11-09T23:00:00'));
    expect(throttle.claimDigest).not.toHaveBeenCalled();
    expect(sender.sendToAll).not.toHaveBeenCalled();
  });

  it('org sem config: não consulta nada', async () => {
    const { service, repository } = setup({ settings: { responseSlaMinutes: 15 } });
    await service.runTick(tenAm);
    expect(repository.listOpenWaits).not.toHaveBeenCalled();
  });

  it('falha de banco não escapa do tique e vai para o ErrorReporter', async () => {
    const { service, repository, errors } = setup();
    repository.listOpenWaits.mockRejectedValue(new Error('db fora'));
    await expect(service.runTick(tenAm)).resolves.toBeUndefined();
    expect(errors.report).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SLA_MANAGER_ALERT_FAILED', organizationId: 'org1' }),
    );
  });

  it('erro da Meta num destinatário vai para o ErrorReporter', async () => {
    const { service, sender, errors } = setup();
    sender.sendToAll.mockResolvedValue([{ phone: '5511947156251', ok: false, error: 'template não existe' }]);
    await service.runTick(tenAm);
    expect(errors.report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'WARNING', message: expect.stringContaining('template não existe') }),
    );
  });
});

describe('ManagerAlertsService.runTick — placar', () => {
  const okRow = { agentId: 'u1', agentName: 'Renata', respondedAt: new Date(), breached: false };

  it('sai no horário configurado, uma vez por dia', async () => {
    const { service, sender, throttle } = setup({ waits: [], rows: [okRow] });
    await service.runTick(sp('2026-11-09T22:10:00'));
    expect(throttle.claimScoreboard).toHaveBeenCalledWith('org1', '2026-11-09');
    expect(sender.sendToAll).toHaveBeenCalledTimes(1);
  });

  it('dia sem esperas: não sai', async () => {
    const { service, sender } = setup({ waits: [], rows: [] });
    await service.runTick(sp('2026-11-09T22:10:00'));
    expect(sender.sendToAll).not.toHaveBeenCalled();
  });

  it('fora do horário: não sai', async () => {
    const { service, repository } = setup({ waits: [], rows: [okRow] });
    await service.runTick(sp('2026-11-09T15:00:00'));
    expect(repository.listCountedWaits).not.toHaveBeenCalled();
  });
});

describe('ManagerAlertsService.sendTest', () => {
  it('ignora trava, silêncio e zero: manda "0"/"nenhum"', async () => {
    const { service, sender, throttle } = setup({ waits: [], claim: false });
    const report = await service.sendTest('org1', 'digest', sp('2026-11-09T23:30:00'));
    expect(throttle.claimDigest).not.toHaveBeenCalled();
    expect(report).toMatchObject({ kind: 'digest', template: 'alerta_sla_gestao', count: 0 });
    expect(report.results[0]).toMatchObject({ phone: '5511947156251', ok: true });
    const params = sender.sendToAll.mock.calls[0][3]({ name: 'Renata', phone: 'x' });
    expect(params).toEqual(['Renata', '0', 'nenhum', 'nenhum']);
  });

  it('placar de teste com zero esperas', async () => {
    const { service, sender } = setup({ rows: [] });
    const report = await service.sendTest('org1', 'scoreboard', sp('2026-11-09T11:00:00'));
    expect(report).toMatchObject({ kind: 'scoreboard', template: 'placar_sla_dia', count: 0 });
    expect(sender.sendToAll.mock.calls[0][3]({ name: 'Rafael', phone: 'x' })).toEqual([
      'Rafael',
      'nenhum',
      'nenhum',
    ]);
  });

  it('canal ausente volta como erro por destinatário', async () => {
    const { service, repository, sender } = setup();
    repository.findChannel.mockResolvedValue(null);
    const report = await service.sendTest('org1', 'digest', sp('2026-11-09T10:00:00'));
    expect(sender.sendToAll).not.toHaveBeenCalled();
    expect(report.results).toEqual([
      { phone: '5511947156251', ok: false, error: expect.stringContaining('canal ch1') },
    ]);
  });

  it('sem config: 400 com o motivo', async () => {
    const { service } = setup({ settings: { slaManagerAlerts: { channelId: 'ch1' } } });
    await expect(service.sendTest('org1', 'digest', new Date())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
