import * as crypto from 'crypto';
import { WhatsAppOfficialInboundAdapter } from './whatsapp-official.inbound-adapter';
import { WhatsAppOfficialMessageMapper } from './whatsapp-official.message-mapper';
import { WhatsAppPlatformConfigService } from './whatsapp-platform-config.service';
import { MessageContentType } from '../../ports/types';

function sign(body: string, secret: string) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
}

describe('WhatsAppOfficialMessageMapper.normalizeInbound — respostas de botão', () => {
  const mapper = new WhatsAppOfficialMessageMapper();

  it('captura o texto do botão de TEMPLATE (type: button)', () => {
    const r = mapper.normalizeInbound(
      {
        id: 'wamid.1',
        from: '5511999999999',
        timestamp: '1700000000',
        type: 'button',
        button: { payload: 'CONTINUAR', text: 'Sim, quero continuar' },
      },
      {},
    );
    expect(r!.type).toBe(MessageContentType.INTERACTIVE);
    expect(r!.content.text).toBe('Sim, quero continuar');
    expect(r!.content.interactive?.payload).toBe('CONTINUAR');
  });

  it('captura o título do button_reply (interactive)', () => {
    const r = mapper.normalizeInbound(
      {
        id: 'wamid.2',
        from: '5511999999999',
        timestamp: '1700000000',
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'btn_1', title: 'Confirmar' },
        },
      },
      {},
    );
    expect(r!.type).toBe(MessageContentType.INTERACTIVE);
    expect(r!.content.text).toBe('Confirmar');
    expect(r!.content.interactive?.buttonId).toBe('btn_1');
  });
});

describe('WhatsAppOfficialInboundAdapter.parseWebhook — template status', () => {
  const adapter = new WhatsAppOfficialInboundAdapter(
    new WhatsAppOfficialMessageMapper(),
    new WhatsAppPlatformConfigService(),
  );

  it('extrai message_template_status_update', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: 'message_template_status_update',
              value: {
                message_template_id: 'META1',
                event: 'APPROVED',
                reason: null,
              },
            },
          ],
        },
      ],
    };
    const res = adapter.parseWebhook(payload as any, { id: 'ch1' } as any);
    expect(res.templateStatusUpdates).toContainEqual({
      metaTemplateId: 'META1',
      status: 'APPROVED',
      reason: undefined,
    });
  });
});

describe('WhatsAppOfficialInboundAdapter.validateWebhook', () => {
  const platform = new WhatsAppPlatformConfigService();
  const adapter = new WhatsAppOfficialInboundAdapter({} as any, platform);
  const body = '{"hello":"world"}';

  afterEach(() => { delete process.env.WA_APP_SECRET; });

  it('usa o app secret da plataforma quando setado', () => {
    process.env.WA_APP_SECRET = 'platform-secret';
    const headers = { 'x-hub-signature-256': sign(body, 'platform-secret') };
    const channel = { id: 'c1', config: {} } as any;
    expect(adapter.validateWebhook(headers, Buffer.from(body), undefined, channel)).toBe(true);
  });

  it('plataforma tem prioridade sobre o appSecret do canal', () => {
    process.env.WA_APP_SECRET = 'platform-secret';
    const headers = { 'x-hub-signature-256': sign(body, 'platform-secret') };
    const channel = { id: 'c1', config: { appSecret: 'canal-secret' } } as any;
    expect(adapter.validateWebhook(headers, Buffer.from(body), undefined, channel)).toBe(true);
  });

  it('usa o appSecret do canal como fallback quando a plataforma nao esta setada', () => {
    delete process.env.WA_APP_SECRET;
    const headers = { 'x-hub-signature-256': sign(body, 'canal-secret') };
    const channel = { id: 'c1', config: { appSecret: 'canal-secret' } } as any;
    expect(adapter.validateWebhook(headers, Buffer.from(body), undefined, channel)).toBe(true);
  });

  it('rejeita quando nao ha secret nenhum', () => {
    delete process.env.WA_APP_SECRET;
    const channel = { id: 'c1', config: {} } as any;
    const headers = { 'x-hub-signature-256': sign(body, 'qualquer') };
    expect(adapter.validateWebhook(headers, Buffer.from(body), undefined, channel)).toBe(false);
  });
});
