import { NotificationType, OrgRole } from '@prisma/client';
import { InstagramTokenRefreshCron } from './instagram-token-refresh.cron';
import { InstagramPlatformConfigService } from './instagram-platform-config.service';

const DIA = 24 * 60 * 60 * 1000;

function canal(diasRestantes: number, extra: Record<string, any> = {}) {
  return {
    id: 'ch_1',
    organizationId: 'org_1',
    name: 'lojax',
    config: {
      igBusinessId: 'IG1',
      accessToken: 'LONGO',
      tokenExpiresAt: new Date(Date.now() + diasRestantes * DIA).toISOString(),
      ...extra,
    },
  };
}

describe('InstagramTokenRefreshCron', () => {
  const platform = new InstagramPlatformConfigService();
  let repo: { findActiveByType: jest.Mock; update: jest.Mock };
  let connect: { refreshToken: jest.Mock };
  let notifications: { notifyOrgAgents: jest.Mock };
  let redis: { set: jest.Mock };
  let queue: { add: jest.Mock };
  let cron: InstagramTokenRefreshCron;

  beforeEach(() => {
    delete process.env.IG_TOKEN_REFRESH_THRESHOLD_DAYS;
    repo = { findActiveByType: jest.fn(), update: jest.fn().mockResolvedValue({}) };
    connect = { refreshToken: jest.fn() };
    notifications = { notifyOrgAgents: jest.fn().mockResolvedValue({}) };
    redis = { set: jest.fn().mockResolvedValue('OK') };
    queue = { add: jest.fn().mockResolvedValue({}) };
    cron = new InstagramTokenRefreshCron(
      queue as any,
      repo as any,
      connect as any,
      notifications as any,
      platform,
      redis as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('nao toca em canal com 30 dias restantes', async () => {
    repo.findActiveByType.mockResolvedValue([canal(30)]);
    const r = await cron.process({} as any);
    expect(connect.refreshToken).not.toHaveBeenCalled();
    expect(r).toEqual({ verificados: 1, renovados: 0, falhas: 0 });
  });

  it('renova canal com 10 dias restantes e grava o novo vencimento', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000);
    repo.findActiveByType.mockResolvedValue([canal(10)]);
    connect.refreshToken.mockResolvedValue({ accessToken: 'NOVO', expiresIn: 5184000 });

    const r = await cron.process({} as any);

    expect(connect.refreshToken).toHaveBeenCalledWith('LONGO');
    expect(repo.update).toHaveBeenCalledWith(
      'ch_1',
      expect.objectContaining({
        config: expect.objectContaining({
          accessToken: 'NOVO',
          tokenExpiresAt: new Date(1_000_000_000_000 + 5184000 * 1000).toISOString(),
          refreshFailures: 0,
        }),
      }),
    );
    expect(r).toEqual({ verificados: 1, renovados: 1, falhas: 0 });
  });

  it('em falha, notifica a org uma vez e NAO desativa o canal', async () => {
    repo.findActiveByType.mockResolvedValue([canal(10)]);
    connect.refreshToken.mockRejectedValue(new Error('token invalido'));

    const r = await cron.process({} as any);

    expect(notifications.notifyOrgAgents).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        type: NotificationType.SYSTEM,
        // Alerta técnico: só quem pode reconectar (o /authorize é OWNER/ADMIN).
        // Mandar pra atendente treina a equipe a ignorar o sino.
        roles: [OrgRole.OWNER, OrgRole.ADMIN],
      }),
    );
    // Desativar recriaria o apagao: canal inativo descarta inbound em silencio.
    const [, data] = repo.update.mock.calls[0];
    expect(data).not.toHaveProperty('isActive');
    expect(data.config.refreshFailures).toBe(1);
    expect(r).toEqual({ verificados: 1, renovados: 0, falhas: 1 });
  });

  it('respeita o throttle: nao notifica de novo dentro de 24h', async () => {
    repo.findActiveByType.mockResolvedValue([canal(10)]);
    connect.refreshToken.mockRejectedValue(new Error('token invalido'));
    redis.set.mockResolvedValue(null); // chave de throttle ja existe

    await cron.process({} as any);

    expect(notifications.notifyOrgAgents).not.toHaveBeenCalled();
  });

  it('ignora canal sem tokenExpiresAt sem quebrar a varredura', async () => {
    repo.findActiveByType.mockResolvedValue([
      { id: 'ch_sem', organizationId: 'org_1', name: 'antigo', config: { accessToken: 'X' } },
      canal(30),
    ]);
    const r = await cron.process({} as any);
    expect(r.verificados).toBe(2);
    expect(r.falhas).toBe(0);
  });

  it('uma falha nao interrompe a varredura dos canais seguintes', async () => {
    repo.findActiveByType.mockResolvedValue([
      { ...canal(10), id: 'ch_a' },
      { ...canal(10), id: 'ch_b' },
    ]);
    connect.refreshToken
      .mockRejectedValueOnce(new Error('token invalido'))
      .mockResolvedValueOnce({ accessToken: 'NOVO', expiresIn: 5184000 });

    const r = await cron.process({} as any);

    expect(connect.refreshToken).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ verificados: 2, renovados: 1, falhas: 1 });
  });

  it('falha ao gravar ou alertar nao interrompe a varredura', async () => {
    repo.findActiveByType.mockResolvedValue([
      { ...canal(10), id: 'ch_a' },
      { ...canal(10), id: 'ch_b' },
    ]);
    connect.refreshToken
      .mockRejectedValueOnce(new Error('token invalido'))
      .mockResolvedValueOnce({ accessToken: 'NOVO', expiresIn: 5184000 });
    repo.update.mockRejectedValueOnce(new Error('banco fora')); // grava do ch_a falha

    const r = await cron.process({} as any);

    expect(connect.refreshToken).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ verificados: 2, renovados: 1, falhas: 1 });
  });
});
