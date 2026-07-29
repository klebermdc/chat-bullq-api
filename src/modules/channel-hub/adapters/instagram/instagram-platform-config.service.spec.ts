import { InstagramPlatformConfigService } from './instagram-platform-config.service';

describe('InstagramPlatformConfigService', () => {
  const svc = new InstagramPlatformConfigService();
  const ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ENV };
  });

  it('apiVersion cai no default v24.0', () => {
    expect(svc.apiVersion).toBe('v24.0');
  });

  it('apiVersion respeita o env', () => {
    process.env.IG_API_VERSION = 'v25.0';
    expect(svc.apiVersion).toBe('v25.0');
  });

  it('returnAllowlist parseia lista separada por virgula e ignora espacos', () => {
    process.env.IG_RETURN_ALLOWLIST = ' sendtur.com.br , app.exemplo.com ';
    expect(svc.returnAllowlist).toEqual(['sendtur.com.br', 'app.exemplo.com']);
  });

  it('returnAllowlist vazia quando o env nao existe', () => {
    expect(svc.returnAllowlist).toEqual([]);
  });

  it('isConfigured e falso sem as credenciais', () => {
    expect(svc.isConfigured).toBe(false);
  });

  it('isConfigured exige appId, appSecret, redirectUri e stateSecret', () => {
    process.env.IG_APP_ID = 'app';
    process.env.IG_APP_SECRET = 'sec';
    process.env.IG_REDIRECT_URI = 'https://api.exemplo.com/cb';
    expect(svc.isConfigured).toBe(false);
    process.env.IG_STATE_SECRET = 'st';
    expect(svc.isConfigured).toBe(true);
  });

  it('refreshThresholdDays cai no default 15', () => {
    expect(svc.refreshThresholdDays).toBe(15);
  });

  it('refreshThresholdDays respeita o env', () => {
    process.env.IG_TOKEN_REFRESH_THRESHOLD_DAYS = '7';
    expect(svc.refreshThresholdDays).toBe(7);
  });

  it.each(['0', '-5', 'abc', ''])(
    'refreshThresholdDays ignora valor invalido (%s) e usa o default',
    (valor) => {
      process.env.IG_TOKEN_REFRESH_THRESHOLD_DAYS = valor;
      expect(svc.refreshThresholdDays).toBe(15);
    },
  );
});
