import * as crypto from 'crypto';
import { WhatsAppOfficialInboundAdapter } from './whatsapp-official.inbound-adapter';
import { WhatsAppPlatformConfigService } from './whatsapp-platform-config.service';

function sign(body: string, secret: string) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
}

describe('WhatsAppOfficialInboundAdapter.validateWebhook', () => {
  const platform = new WhatsAppPlatformConfigService();
  const adapter = new WhatsAppOfficialInboundAdapter({} as any, platform);
  const body = '{"hello":"world"}';

  afterEach(() => { delete process.env.WA_APP_SECRET; });

  it('valida com o app secret da plataforma quando o canal nao tem appSecret', () => {
    process.env.WA_APP_SECRET = 'platform-secret';
    const headers = { 'x-hub-signature-256': sign(body, 'platform-secret') };
    const channel = { id: 'c1', config: {} } as any;
    expect(adapter.validateWebhook(headers, Buffer.from(body), undefined, channel)).toBe(true);
  });

  it('prioriza o appSecret do proprio canal (fallback legado)', () => {
    process.env.WA_APP_SECRET = 'platform-secret';
    const headers = { 'x-hub-signature-256': sign(body, 'canal-secret') };
    const channel = { id: 'c1', config: { appSecret: 'canal-secret' } } as any;
    expect(adapter.validateWebhook(headers, Buffer.from(body), undefined, channel)).toBe(true);
  });

  it('rejeita quando nao ha secret nenhum', () => {
    const channel = { id: 'c1', config: {} } as any;
    const headers = { 'x-hub-signature-256': sign(body, 'qualquer') };
    expect(adapter.validateWebhook(headers, Buffer.from(body), undefined, channel)).toBe(false);
  });
});
