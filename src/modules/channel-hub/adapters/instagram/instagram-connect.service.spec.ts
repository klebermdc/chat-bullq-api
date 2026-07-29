import axios from 'axios';
import { ChannelType, OrgRole } from '@prisma/client';
import { InstagramConnectService } from './instagram-connect.service';
import { InstagramPlatformConfigService } from './instagram-platform-config.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('InstagramConnectService (chamadas Graph)', () => {
  const platform = new InstagramPlatformConfigService();
  const svc = new InstagramConnectService(
    platform,
    {} as any, // ChannelsService
    {} as any, // ChannelsRepository
  );

  beforeEach(() => {
    process.env.IG_APP_ID = 'app';
    process.env.IG_APP_SECRET = 'sec';
    process.env.IG_REDIRECT_URI = 'https://api.exemplo.com/cb';
    process.env.IG_API_VERSION = 'v24.0';
    jest.clearAllMocks();
  });

  it('exchangeCodeForToken faz POST form-urlencoded em api.instagram.com', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'CURTO', user_id: 256111 },
    } as any);

    await expect(svc.exchangeCodeForToken('code123')).resolves.toEqual({
      accessToken: 'CURTO',
      loginUserId: '256111',
    });

    const [url, body, cfg] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('https://api.instagram.com/oauth/access_token');
    expect(String(body)).toContain('grant_type=authorization_code');
    expect(String(body)).toContain('code=code123');
    expect((cfg as any).headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('exchangeCodeForToken lanca code_expirado quando a Meta recusa o code', async () => {
    mockedAxios.post.mockRejectedValueOnce({
      response: { data: { error_message: 'This authorization code has been used' } },
    });
    await expect(svc.exchangeCodeForToken('velho')).rejects.toMatchObject({
      slug: 'code_expirado',
    });
  });

  it('exchangeForLongLived troca por token de 60 dias', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { access_token: 'LONGO', expires_in: 5184000 },
    } as any);

    await expect(svc.exchangeForLongLived('CURTO')).resolves.toEqual({
      accessToken: 'LONGO',
      expiresIn: 5184000,
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://graph.instagram.com/access_token',
      { params: { grant_type: 'ig_exchange_token', client_secret: 'sec', access_token: 'CURTO' } },
    );
  });

  it('fetchMe devolve o user_id que casa com o entry.id do webhook', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { id: '256111', user_id: '17841400000000000', username: 'lojax' },
    } as any);

    await expect(svc.fetchMe('LONGO')).resolves.toEqual({
      igBusinessId: '17841400000000000',
      username: 'lojax',
    });
  });

  it('fetchMe lanca sem_conta_business quando nao vem user_id', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { id: '256111', username: 'pessoal' } } as any);
    await expect(svc.fetchMe('LONGO')).rejects.toMatchObject({ slug: 'sem_conta_business' });
  });

  it('fetchMe: erro de rede vira erro_interno, nao sem_conta_business', async () => {
    mockedAxios.get.mockRejectedValueOnce({ message: 'ETIMEDOUT' }); // sem `response`
    await expect(svc.fetchMe('LONGO')).rejects.toMatchObject({ slug: 'erro_interno' });
  });

  it('subscribeApp assina os campos de webhook com Bearer', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);
    await svc.subscribeApp('17841400000000000', 'LONGO');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://graph.instagram.com/v24.0/17841400000000000/subscribed_apps',
      { subscribed_fields: 'messages,messaging_postbacks,messaging_seen' },
      { headers: { Authorization: 'Bearer LONGO' } },
    );
  });

  it('subscribeApp lanca falha_inscricao quando a Meta recusa', async () => {
    mockedAxios.post.mockRejectedValueOnce({ response: { data: { error: { message: 'nope' } } } });
    await expect(svc.subscribeApp('IG1', 'LONGO')).rejects.toMatchObject({
      slug: 'falha_inscricao',
    });
  });

  it('nao loga o code nem o token inteiros', async () => {
    const logSpy = jest
      .spyOn((svc as any).logger, 'error')
      .mockImplementation(() => undefined);
    mockedAxios.post.mockRejectedValueOnce({
      response: { data: { error_message: 'This authorization code has been used' } },
    });

    await expect(
      svc.exchangeCodeForToken('CODE_SUPER_SECRETO_INTEIRO_1234567890'),
    ).rejects.toMatchObject({ slug: 'code_expirado' });

    const logado = logSpy.mock.calls.flat().join(' ');
    expect(logado).not.toContain('CODE_SUPER_SECRETO_INTEIRO_1234567890');
    expect(logado).toContain('CODE_SUPER_S'); // prefixo de 12 chars
    logSpy.mockRestore();
  });

  it('erro de rede vira erro_interno, nao code_expirado', async () => {
    mockedAxios.post.mockRejectedValueOnce({ message: 'ECONNRESET' }); // sem `response`
    await expect(svc.exchangeCodeForToken('c1')).rejects.toMatchObject({
      slug: 'erro_interno',
    });
  });

  it('refreshToken renova o token longo', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { access_token: 'NOVO', expires_in: 5184000 },
    } as any);
    await expect(svc.refreshToken('LONGO')).resolves.toEqual({
      accessToken: 'NOVO',
      expiresIn: 5184000,
    });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://graph.instagram.com/refresh_access_token',
      { params: { grant_type: 'ig_refresh_token', access_token: 'LONGO' } },
    );
  });

  it('refreshToken nao deixa o token vazar no erro', async () => {
    mockedAxios.get.mockRejectedValueOnce({
      message: 'Request failed',
      config: { params: { access_token: 'TOKEN_VIVO_NAO_VAZAR' } },
      response: { data: { error: { message: 'invalid token' } } },
    });
    await expect(svc.refreshToken('TOKEN_VIVO_NAO_VAZAR')).rejects.toThrow('invalid token');

    mockedAxios.get.mockRejectedValueOnce({
      message: 'Request failed',
      config: { params: { access_token: 'TOKEN_VIVO_NAO_VAZAR' } },
      response: { data: { error: { message: 'invalid token' } } },
    });
    try {
      await svc.refreshToken('TOKEN_VIVO_NAO_VAZAR');
      throw new Error('deveria ter lancado');
    } catch (err: any) {
      expect(err.message).not.toContain('TOKEN_VIVO_NAO_VAZAR');
    }
  });
});

describe('InstagramConnectService.connect', () => {
  const platform = new InstagramPlatformConfigService();
  let channelsService: { create: jest.Mock };
  let channelsRepo: { findActiveByTypeAndOrg: jest.Mock; update: jest.Mock };
  let svc: InstagramConnectService;

  const identidade = {
    organizationId: 'org_1',
    userOrganizationId: 'uo_1',
    role: OrgRole.OWNER,
  };

  function mockFluxoFeliz() {
    // 1) code -> token curto
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'CURTO', user_id: 256111 },
    } as any);
    // 2) token curto -> token longo
    mockedAxios.get.mockResolvedValueOnce({
      data: { access_token: 'LONGO', expires_in: 5184000 },
    } as any);
    // 3) /me
    mockedAxios.get.mockResolvedValueOnce({
      data: { id: '256111', user_id: '17841400000000000', username: 'lojax' },
    } as any);
    // 4) subscribed_apps
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);
  }

  beforeEach(() => {
    process.env.IG_APP_ID = 'app';
    process.env.IG_APP_SECRET = 'sec';
    process.env.IG_REDIRECT_URI = 'https://api.exemplo.com/cb';
    process.env.IG_API_VERSION = 'v24.0';
    jest.clearAllMocks();

    channelsService = { create: jest.fn(async (_o, dto) => ({ id: 'ch_novo', ...dto })) };
    channelsRepo = {
      findActiveByTypeAndOrg: jest.fn().mockResolvedValue([]),
      update: jest.fn(async (id, data) => ({ id, ...data })),
    };
    svc = new InstagramConnectService(platform, channelsService as any, channelsRepo as any);
  });

  it('grava o user_id do /me como igBusinessId, nao o do token', async () => {
    mockFluxoFeliz();
    await svc.connect({ code: 'c1', ...identidade });

    const [, dto] = channelsService.create.mock.calls[0];
    expect(dto.config.igBusinessId).toBe('17841400000000000');
    expect(dto.config.igUserId).toBe('256111');
    expect(dto.type).toBe(ChannelType.INSTAGRAM);
    expect(dto.name).toBe('lojax');
  });

  it('carimba o appSecret da plataforma para o validateWebhook nao ficar fail-open', async () => {
    mockFluxoFeliz();
    await svc.connect({ code: 'c1', ...identidade });
    const [, dto] = channelsService.create.mock.calls[0];
    expect(dto.config.appSecret).toBe('sec');
  });

  it('grava tokenExpiresAt a partir do expires_in', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000);
    mockFluxoFeliz();
    await svc.connect({ code: 'c1', ...identidade });
    const [, dto] = channelsService.create.mock.calls[0];
    expect(dto.config.tokenExpiresAt).toBe(
      new Date(1_000_000_000_000 + 5184000 * 1000).toISOString(),
    );
    jest.restoreAllMocks();
  });

  it('reconectar atualiza o canal existente em vez de criar outro', async () => {
    channelsRepo.findActiveByTypeAndOrg.mockResolvedValue([
      { id: 'ch_velho', config: { igBusinessId: '17841400000000000', apelido: 'preservar' } },
    ]);
    mockFluxoFeliz();

    await svc.connect({ code: 'c1', ...identidade });

    expect(channelsService.create).not.toHaveBeenCalled();
    expect(channelsRepo.update).toHaveBeenCalledWith(
      'ch_velho',
      expect.objectContaining({
        config: expect.objectContaining({
          igBusinessId: '17841400000000000',
          accessToken: 'LONGO',
          apelido: 'preservar', // não joga fora o que já estava no config
        }),
      }),
    );
  });

  it('falha no subscribed_apps aborta e nao deixa canal orfao', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'CURTO', user_id: 256111 },
    } as any);
    mockedAxios.get.mockResolvedValueOnce({
      data: { access_token: 'LONGO', expires_in: 5184000 },
    } as any);
    mockedAxios.get.mockResolvedValueOnce({
      data: { id: '256111', user_id: '17841400000000000', username: 'lojax' },
    } as any);
    mockedAxios.post.mockRejectedValueOnce({ response: { data: { error: { message: 'nope' } } } });

    await expect(svc.connect({ code: 'c1', ...identidade })).rejects.toMatchObject({
      slug: 'falha_inscricao',
    });
    expect(channelsService.create).not.toHaveBeenCalled();
    expect(channelsRepo.update).not.toHaveBeenCalled();
  });
});
