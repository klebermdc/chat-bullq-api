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
