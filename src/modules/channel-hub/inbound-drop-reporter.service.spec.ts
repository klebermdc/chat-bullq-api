import {
  InboundDropReporter,
  InboundDropReason,
} from './inbound-drop-reporter.service';

const channel = { id: 'ch1', name: 'Comercial', organizationId: 'org1' };

const build = () => {
  const webhookEvents = { recordDropped: jest.fn().mockResolvedValue('evt1') };
  const notifications = { notifyOrgAgents: jest.fn().mockResolvedValue({}) };
  // 'OK' = ganhou o slot de alerta; null = já alertado dentro da janela.
  const redis = { set: jest.fn().mockResolvedValue('OK') };
  const reporter = new InboundDropReporter(
    webhookEvents as any,
    notifications as any,
    redis as any,
  );
  return { webhookEvents, notifications, redis, reporter };
};

const drop = (reason: InboundDropReason, ch: typeof channel | null) => ({
  channelType: 'WHATSAPP_OFFICIAL' as any,
  reason,
  payload: { foo: 'bar' },
  headers: {},
  channel: ch,
});

describe('InboundDropReporter', () => {
  it('sempre persiste o descarte, mesmo sem canal', async () => {
    const { webhookEvents, reporter } = build();

    await reporter.reportDrop(drop(InboundDropReason.NO_LOCATORS, null));

    expect(webhookEvents.recordDropped).toHaveBeenCalledTimes(1);
    const arg = webhookEvents.recordDropped.mock.calls[0][0];
    expect(arg.reason).toContain('NO_LOCATORS');
    expect(arg.channelId).toBeNull();
  });

  it('alerta o OWNER quando o canal está desativado', async () => {
    const { notifications, reporter } = build();

    await reporter.reportDrop(drop(InboundDropReason.CHANNEL_INACTIVE, channel));

    expect(notifications.notifyOrgAgents).toHaveBeenCalledTimes(1);
    const arg = notifications.notifyOrgAgents.mock.calls[0][0];
    expect(arg.organizationId).toBe('org1');
    expect(arg.roles).toEqual(['OWNER']);
    expect(arg.body).toContain('Comercial');
    expect(arg.data).toMatchObject({ channelId: 'ch1', reason: 'CHANNEL_INACTIVE' });
  });

  it('alerta o OWNER quando a assinatura é inválida', async () => {
    const { notifications, reporter } = build();

    await reporter.reportDrop(drop(InboundDropReason.INVALID_SIGNATURE, channel));

    expect(notifications.notifyOrgAgents).toHaveBeenCalledTimes(1);
  });

  it('não alerta quando não há organização identificável', async () => {
    const { notifications, reporter } = build();

    await reporter.reportDrop(drop(InboundDropReason.NO_LOCATORS, null));
    await reporter.reportDrop(drop(InboundDropReason.UNKNOWN_LOCATOR, null));

    expect(notifications.notifyOrgAgents).not.toHaveBeenCalled();
  });

  it('não alerta em motivos sem alerta mesmo com canal conhecido', async () => {
    const { notifications, reporter } = build();

    await reporter.reportDrop(drop(InboundDropReason.NO_LOCATORS, channel));
    await reporter.reportDrop(drop(InboundDropReason.UNKNOWN_LOCATOR, channel));

    expect(notifications.notifyOrgAgents).not.toHaveBeenCalled();
  });

  it('não derruba o webhook se a persistência falhar', async () => {
    const { webhookEvents, notifications, reporter } = build();
    webhookEvents.recordDropped.mockRejectedValue(new Error('prisma fora'));

    await expect(
      reporter.reportDrop(drop(InboundDropReason.CHANNEL_INACTIVE, channel)),
    ).resolves.toBeUndefined();
    // persistir falhou, mas o alerta ainda sai
    expect(notifications.notifyOrgAgents).toHaveBeenCalledTimes(1);
  });

  it('não derruba o webhook se o Redis estiver fora', async () => {
    const { redis, notifications, reporter } = build();
    redis.set.mockRejectedValue(new Error('redis fora'));

    await expect(
      reporter.reportDrop(drop(InboundDropReason.CHANNEL_INACTIVE, channel)),
    ).resolves.toBeUndefined();
    // gate do throttle falhou → alerta é perdido, não deve ser enviado mesmo assim
    expect(notifications.notifyOrgAgents).not.toHaveBeenCalled();
  });

  it('só alerta uma vez por canal+motivo dentro da janela', async () => {
    const { redis, notifications, reporter } = build();
    // 1ª chamada ganha o slot, 2ª encontra a chave já gravada
    redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await reporter.reportDrop(drop(InboundDropReason.CHANNEL_INACTIVE, channel));
    await reporter.reportDrop(drop(InboundDropReason.CHANNEL_INACTIVE, channel));

    expect(notifications.notifyOrgAgents).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      'chdrop:WHATSAPP_OFFICIAL:CHANNEL_INACTIVE:ch1',
      '1',
      'EX',
      900,
      'NX',
    );
  });

  it('persiste os dois descartes mesmo alertando só uma vez', async () => {
    const { redis, webhookEvents, notifications, reporter } = build();
    redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await reporter.reportDrop(drop(InboundDropReason.CHANNEL_INACTIVE, channel));
    await reporter.reportDrop(drop(InboundDropReason.CHANNEL_INACTIVE, channel));

    // throttle é do alerta, não da auditoria
    expect(webhookEvents.recordDropped).toHaveBeenCalledTimes(2);
    expect(notifications.notifyOrgAgents).toHaveBeenCalledTimes(1);
  });
});
