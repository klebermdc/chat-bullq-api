import axios from 'axios';
import { WhatsAppEmbeddedSignupService } from './whatsapp-embedded-signup.service';
import { WhatsAppPlatformConfigService } from './whatsapp-platform-config.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('WhatsAppEmbeddedSignupService (graph calls)', () => {
  const platform = new WhatsAppPlatformConfigService();
  const svc = new WhatsAppEmbeddedSignupService(platform, {} as any, {} as any);

  beforeEach(() => {
    process.env.WA_APP_ID = 'app'; process.env.WA_APP_SECRET = 'sec'; process.env.WA_API_VERSION = 'v21.0';
    delete process.env.WA_REG_PIN;
    jest.clearAllMocks();
  });

  it('exchangeCodeForToken retorna o access_token', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { access_token: 'TKN' } } as any);
    await expect(svc.exchangeCodeForToken('code123')).resolves.toBe('TKN');
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/oauth/access_token',
      { params: { client_id: 'app', client_secret: 'sec', code: 'code123' } },
    );
  });

  it('exchangeCodeForToken lanca se nao vier token', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: {} } as any);
    await expect(svc.exchangeCodeForToken('bad')).rejects.toThrow();
  });

  it('subscribeWaba faz POST no subscribed_apps com Bearer', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);
    await svc.subscribeWaba('WABA1', 'TKN');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/WABA1/subscribed_apps',
      {},
      { headers: { Authorization: 'Bearer TKN' } },
    );
  });

  it('getPhoneMetadata busca display_phone_number e verified_name', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { display_phone_number: '+55', verified_name: 'NY Fast Pass' } } as any);
    await expect(svc.getPhoneMetadata('PN1', 'TKN')).resolves.toEqual({ display_phone_number: '+55', verified_name: 'NY Fast Pass' });
  });

  it('registerNumber faz POST em /{phoneId}/register com messaging_product e pin', async () => {
    process.env.WA_REG_PIN = '123456';
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);
    await svc.registerNumber('PN1', 'TKN');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/PN1/register',
      { messaging_product: 'whatsapp', pin: '123456' },
      { headers: { Authorization: 'Bearer TKN' } },
    );
  });

  it('registerNumber lanca quando o PIN nao esta configurado', async () => {
    delete process.env.WA_REG_PIN;
    await expect(svc.registerNumber('PN1', 'TKN')).rejects.toThrow(/WA_REG_PIN/);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

describe('WhatsAppEmbeddedSignupService.disconnect', () => {
  beforeEach(() => {
    process.env.WA_APP_ID = 'app'; process.env.WA_APP_SECRET = 'sec'; process.env.WA_API_VERSION = 'v21.0';
    jest.clearAllMocks();
  });

  function makeSvc(channel: any) {
    const platform = new WhatsAppPlatformConfigService();
    const channelsRepo = {
      findById: jest.fn().mockResolvedValue(channel),
      update: jest.fn().mockResolvedValue({}),
    } as any;
    return { svc: new WhatsAppEmbeddedSignupService(platform, {} as any, channelsRepo), channelsRepo };
  }

  it('chama o /deregister e desativa o canal', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);
    const { svc, channelsRepo } = makeSvc({
      id: 'ch1', config: { phoneNumberId: 'PN1', accessToken: 'TKN', registeredAt: '2026-01-01' },
    });

    await expect(svc.disconnect('ch1')).resolves.toEqual({ deregistered: true });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/PN1/deregister',
      {},
      { headers: { Authorization: 'Bearer TKN' } },
    );
    expect(channelsRepo.update.mock.calls[0][1].isActive).toBe(false);
  });

  // Quase sempre a chamada falha porque o cliente JA revogou o acesso. Deixar
  // o canal "Ativo" nesse caso e pior que a falha: manda o operador procurar
  // um problema que nao existe mais.
  it('desativa o canal MESMO se o deregister falhar', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('token revogado'));
    const { svc, channelsRepo } = makeSvc({
      id: 'ch1', config: { phoneNumberId: 'PN1', accessToken: 'TKN' },
    });

    await expect(svc.disconnect('ch1')).resolves.toEqual({ deregistered: false });
    expect(channelsRepo.update.mock.calls[0][1].isActive).toBe(false);
  });

  it('limpa o registeredAt — reconectar precisa registrar de novo', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: {} } as any);
    const { svc, channelsRepo } = makeSvc({
      id: 'ch1', config: { phoneNumberId: 'PN1', accessToken: 'TKN', registeredAt: '2026-01-01' },
    });

    await svc.disconnect('ch1');
    const cfg = channelsRepo.update.mock.calls[0][1].config;
    expect(cfg.registeredAt).toBeUndefined();
    expect(cfg.deregisteredAt).toBeDefined();
  });

  it('canal sem credencial nao chama a Meta, mas ainda desativa', async () => {
    const { svc, channelsRepo } = makeSvc({ id: 'ch1', config: {} });
    await expect(svc.disconnect('ch1')).resolves.toEqual({ deregistered: false });
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(channelsRepo.update).toHaveBeenCalled();
  });
});

describe('WhatsAppEmbeddedSignupService.connect', () => {
  beforeEach(() => {
    process.env.WA_APP_ID = 'app'; process.env.WA_APP_SECRET = 'sec'; process.env.WA_API_VERSION = 'v21.0';
    delete process.env.WA_REG_PIN;
    jest.clearAllMocks();
  });

  function makeSvc(existing: any[] = []) {
    const platform = new WhatsAppPlatformConfigService();
    const channelsService = { create: jest.fn().mockResolvedValue({ id: 'new-channel' }) } as any;
    const channelsRepo = {
      findActiveByTypeAndOrg: jest.fn().mockResolvedValue(existing),
      update: jest.fn().mockResolvedValue({ id: 'updated-channel' }),
    } as any;
    return { svc: new WhatsAppEmbeddedSignupService(platform, channelsService, channelsRepo), channelsService, channelsRepo };
  }

  it('cria um canal novo quando o phoneNumberId ainda nao existe', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { access_token: 'TKN' } } as any); // exchange
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);       // subscribe
    mockedAxios.get.mockResolvedValueOnce({ data: { verified_name: 'NY Fast Pass', display_phone_number: '+55' } } as any); // metadata

    const { svc, channelsService } = makeSvc([]);
    const res = await svc.connect({ code: 'c', phoneNumberId: 'PN1', wabaId: 'WABA1', organizationId: 'org1', creator: { userOrganizationId: 'uo1', role: 'OWNER' as any } });

    expect(res).toEqual({ id: 'new-channel' });
    expect(channelsService.create).toHaveBeenCalledWith('org1', {
      type: 'WHATSAPP_OFFICIAL',
      name: 'NY Fast Pass',
      config: { accessToken: 'TKN', phoneNumberId: 'PN1', businessAccountId: 'WABA1', apiVersion: 'v21.0' },
    }, { userOrganizationId: 'uo1', role: 'OWNER' });
  });

  it('faz update quando ja existe canal com o mesmo phoneNumberId (upsert)', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { access_token: 'TKN2' } } as any);
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);
    mockedAxios.get.mockResolvedValueOnce({ data: { verified_name: 'NY Fast Pass' } } as any);

    const existing = [{ id: 'exist1', config: { phoneNumberId: 'PN1', appSecret: 'legacy-secret' } }];
    const { svc, channelsRepo, channelsService } = makeSvc(existing);
    const res = await svc.connect({ code: 'c', phoneNumberId: 'PN1', wabaId: 'WABA1', organizationId: 'org1', creator: { userOrganizationId: 'uo1', role: 'OWNER' as any } });

    expect(res).toEqual({ id: 'updated-channel' });
    expect(channelsService.create).not.toHaveBeenCalled();
    expect(channelsRepo.update).toHaveBeenCalledWith('exist1', expect.objectContaining({
      name: 'NY Fast Pass',
      config: expect.objectContaining({
        accessToken: 'TKN2',
        phoneNumberId: 'PN1',
        businessAccountId: 'WABA1',
        apiVersion: 'v21.0',
        appSecret: 'legacy-secret',
      }),
    }));
  });

  it('registra o numero na Cloud API quando o PIN esta configurado', async () => {
    process.env.WA_REG_PIN = '123456';
    mockedAxios.get.mockResolvedValueOnce({ data: { access_token: 'TKN' } } as any);   // exchange
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);        // subscribe
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);        // register
    mockedAxios.get.mockResolvedValueOnce({ data: { verified_name: 'NY Fast Pass' } } as any); // metadata

    const { svc } = makeSvc([]);
    await svc.connect({ code: 'c', phoneNumberId: 'PN1', wabaId: 'WABA1', organizationId: 'org1' });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/PN1/register',
      { messaging_product: 'whatsapp', pin: '123456' },
      { headers: { Authorization: 'Bearer TKN' } },
    );
  });

  it('nao tenta registrar quando o PIN nao esta configurado', async () => {
    delete process.env.WA_REG_PIN;
    mockedAxios.get.mockResolvedValueOnce({ data: { access_token: 'TKN' } } as any);
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);        // subscribe
    mockedAxios.get.mockResolvedValueOnce({ data: { verified_name: 'NY Fast Pass' } } as any);

    const { svc } = makeSvc([]);
    await svc.connect({ code: 'c', phoneNumberId: 'PN1', wabaId: 'WABA1', organizationId: 'org1' });

    expect(mockedAxios.post).toHaveBeenCalledTimes(1); // so o subscribe
  });

  // O /register tem cota de 10 chamadas por numero em 72h (erro 133016 trava
  // por 72 horas). Reconectar um canal ja registrado NAO pode gastar a cota.
  it('nao re-registra um canal que ja tem registeredAt no config', async () => {
    process.env.WA_REG_PIN = '123456';
    mockedAxios.get.mockResolvedValueOnce({ data: { access_token: 'TKN' } } as any);
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);        // subscribe
    mockedAxios.get.mockResolvedValueOnce({ data: { verified_name: 'NY Fast Pass' } } as any);

    const existing = [{ id: 'exist1', config: { phoneNumberId: 'PN1', registeredAt: '2026-07-01T00:00:00.000Z' } }];
    const { svc } = makeSvc(existing);
    await svc.connect({ code: 'c', phoneNumberId: 'PN1', wabaId: 'WABA1', organizationId: 'org1' });

    expect(mockedAxios.post).toHaveBeenCalledTimes(1); // so o subscribe, sem register
  });

  // A doc de coexistencia manda PULAR o /register: o numero ja roda no app do
  // WhatsApp Business e ja esta registrado. Chamar assim mesmo gasta a cota
  // de 10/72h e pode derrubar o registro do cliente.
  it('NAO registra quando o desfecho e coexistencia, mesmo com PIN configurado', async () => {
    process.env.WA_REG_PIN = '123456';
    mockedAxios.get.mockResolvedValueOnce({ data: { access_token: 'TKN' } } as any);
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);  // subscribe
    mockedAxios.get.mockResolvedValueOnce({ data: { verified_name: 'OFP' } } as any);

    const { svc, channelsService } = makeSvc([]);
    await svc.connect({
      code: 'c', phoneNumberId: 'PN1', wabaId: 'WABA1', organizationId: 'org1',
      signupEvent: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    });

    expect(mockedAxios.post).toHaveBeenCalledTimes(1); // so o subscribe
    expect(channelsService.create).toHaveBeenCalledWith('org1', expect.objectContaining({
      config: expect.objectContaining({ coexistence: true }),
    }), undefined);
  });

  it('registra normalmente quando o desfecho e FINISH comum', async () => {
    process.env.WA_REG_PIN = '123456';
    mockedAxios.get.mockResolvedValueOnce({ data: { access_token: 'TKN' } } as any);
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);  // subscribe
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);  // register
    mockedAxios.get.mockResolvedValueOnce({ data: { verified_name: 'OFP' } } as any);

    const { svc, channelsService } = makeSvc([]);
    await svc.connect({
      code: 'c', phoneNumberId: 'PN1', wabaId: 'WABA1', organizationId: 'org1', signupEvent: 'FINISH',
    });

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    const cfg = channelsService.create.mock.calls[0][1].config;
    expect(cfg.coexistence).toBeUndefined();
  });

  it('guarda o businessId (portfolio do cliente) no config quando vem no sessionInfo', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { access_token: 'TKN' } } as any);
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);
    mockedAxios.get.mockResolvedValueOnce({ data: { verified_name: 'NY Fast Pass' } } as any);

    const { svc, channelsService } = makeSvc([]);
    await svc.connect({ code: 'c', phoneNumberId: 'PN1', wabaId: 'WABA1', businessId: 'BIZ9', organizationId: 'org1' });

    expect(channelsService.create).toHaveBeenCalledWith('org1', expect.objectContaining({
      config: expect.objectContaining({ businessId: 'BIZ9' }),
    }), undefined);
  });

  it('grava registeredAt no config quando o register da certo', async () => {
    process.env.WA_REG_PIN = '123456';
    mockedAxios.get.mockResolvedValueOnce({ data: { access_token: 'TKN' } } as any);
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);        // subscribe
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);        // register
    mockedAxios.get.mockResolvedValueOnce({ data: { verified_name: 'NY Fast Pass' } } as any);

    const { svc, channelsService } = makeSvc([]);
    await svc.connect({ code: 'c', phoneNumberId: 'PN1', wabaId: 'WABA1', organizationId: 'org1' });

    expect(channelsService.create).toHaveBeenCalledWith('org1', expect.objectContaining({
      config: expect.objectContaining({ registeredAt: expect.any(String) }),
    }), undefined);
  });

  it('NAO grava registeredAt quando o register falha (permite nova tentativa)', async () => {
    process.env.WA_REG_PIN = '123456';
    mockedAxios.get.mockResolvedValueOnce({ data: { access_token: 'TKN' } } as any);
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);
    mockedAxios.post.mockRejectedValueOnce(new Error('boom'));                          // register falha
    mockedAxios.get.mockResolvedValueOnce({ data: { verified_name: 'NY Fast Pass' } } as any);

    const { svc, channelsService } = makeSvc([]);
    await svc.connect({ code: 'c', phoneNumberId: 'PN1', wabaId: 'WABA1', organizationId: 'org1' });

    const cfg = channelsService.create.mock.calls[0][1].config;
    expect(cfg.registeredAt).toBeUndefined();
  });

  // O numero pode ja estar registrado (recadastro, ou coexistencia que a Meta
  // registra sozinha). Isso NAO pode abortar uma conexao boa — o canal ja recebe.
  it('nao aborta a conexao quando o register falha', async () => {
    process.env.WA_REG_PIN = '123456';
    mockedAxios.get.mockResolvedValueOnce({ data: { access_token: 'TKN' } } as any);
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } } as any);        // subscribe ok
    mockedAxios.post.mockRejectedValueOnce(new Error('already registered'));           // register falha
    mockedAxios.get.mockResolvedValueOnce({ data: { verified_name: 'NY Fast Pass' } } as any);

    const { svc, channelsService } = makeSvc([]);
    const res = await svc.connect({ code: 'c', phoneNumberId: 'PN1', wabaId: 'WABA1', organizationId: 'org1' });

    expect(res).toEqual({ id: 'new-channel' });
    expect(channelsService.create).toHaveBeenCalled();
  });

  it('lanca BadRequestException com mensagem de etapa quando a inscricao da WABA falha', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { access_token: 'TKN' } } as any); // exchange ok
    mockedAxios.post.mockRejectedValueOnce(new Error('graph 403')); // subscribe fails
    const { svc } = makeSvc([]);
    await expect(
      svc.connect({ code: 'c', phoneNumberId: 'PN1', wabaId: 'WABA1', organizationId: 'org1', creator: { userOrganizationId: 'uo1', role: 'OWNER' as any } }),
    ).rejects.toThrow(/WABA/i);
  });
});
