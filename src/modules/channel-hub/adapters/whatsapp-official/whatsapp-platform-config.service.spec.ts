import { WhatsAppPlatformConfigService } from './whatsapp-platform-config.service';

describe('WhatsAppPlatformConfigService', () => {
  const svc = new WhatsAppPlatformConfigService();
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('defaults apiVersion to v24.0 when unset', () => {
    delete process.env.WA_API_VERSION;
    expect(svc.apiVersion).toBe('v24.0');
  });

  it('registrationPin vem de WA_REG_PIN e é undefined quando ausente', () => {
    delete process.env.WA_REG_PIN;
    expect(svc.registrationPin).toBeUndefined();
    process.env.WA_REG_PIN = '123456';
    expect(svc.registrationPin).toBe('123456');
  });

  it('reads appId/appSecret/configId from env', () => {
    process.env.WA_APP_ID = 'app123';
    process.env.WA_APP_SECRET = 'secret456';
    process.env.WA_ES_CONFIG_ID = 'cfg789';
    expect(svc.appId).toBe('app123');
    expect(svc.appSecret).toBe('secret456');
    expect(svc.embeddedSignupConfigId).toBe('cfg789');
  });

  it('isConfigured is true only with appId AND appSecret', () => {
    delete process.env.WA_APP_ID; delete process.env.WA_APP_SECRET;
    expect(svc.isConfigured).toBe(false);
    process.env.WA_APP_ID = 'x'; process.env.WA_APP_SECRET = 'y';
    expect(svc.isConfigured).toBe(true);
  });
});
