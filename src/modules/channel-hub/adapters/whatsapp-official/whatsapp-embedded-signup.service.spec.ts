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
});

describe('WhatsAppEmbeddedSignupService.connect', () => {
  beforeEach(() => { process.env.WA_APP_ID = 'app'; process.env.WA_APP_SECRET = 'sec'; process.env.WA_API_VERSION = 'v21.0'; jest.clearAllMocks(); });

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

    const existing = [{ id: 'exist1', config: { phoneNumberId: 'PN1' } }];
    const { svc, channelsRepo, channelsService } = makeSvc(existing);
    const res = await svc.connect({ code: 'c', phoneNumberId: 'PN1', wabaId: 'WABA1', organizationId: 'org1', creator: { userOrganizationId: 'uo1', role: 'OWNER' as any } });

    expect(res).toEqual({ id: 'updated-channel' });
    expect(channelsService.create).not.toHaveBeenCalled();
    expect(channelsRepo.update).toHaveBeenCalledWith('exist1', expect.objectContaining({
      name: 'NY Fast Pass',
      config: { accessToken: 'TKN2', phoneNumberId: 'PN1', businessAccountId: 'WABA1', apiVersion: 'v21.0' },
    }));
  });
});
