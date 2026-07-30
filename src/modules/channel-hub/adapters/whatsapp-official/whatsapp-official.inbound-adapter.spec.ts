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

describe('WhatsAppOfficialInboundAdapter.parseWebhook — smb_message_echoes (coexistência)', () => {
  const adapter = new WhatsAppOfficialInboundAdapter(
    new WhatsAppOfficialMessageMapper(),
    new WhatsAppPlatformConfigService(),
  );

  function payload(echoes: any[]) {
    return {
      entry: [
        {
          id: 'WABA1',
          changes: [
            {
              field: 'smb_message_echoes',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '5511519493 95', phone_number_id: 'PN1' },
                message_echoes: echoes,
              },
            },
          ],
        },
      ],
    };
  }

  it('extrai o echo usando o `to` como contraparte (nao o `from`)', () => {
    const res = adapter.parseWebhook(
      payload([
        {
          from: '551151949395', // numero do NEGOCIO
          to: '5511988887777', // numero do CLIENTE
          id: 'wamid.ECHO1',
          timestamp: '1700000000',
          type: 'text',
          text: { body: 'respondi pelo celular' },
        },
      ]) as any,
      { id: 'ch1', config: { phoneNumberId: 'PN1' } } as any,
    );

    expect(res.messageEchoes).toHaveLength(1);
    const e = res.messageEchoes![0];
    expect(e.externalId).toBe('wamid.ECHO1');
    // O CLIENTE e o `to` — se invertermos, o echo cai na conversa errada.
    expect(e.contactPhone).toBe('5511988887777');
    expect(e.businessPhone).toBe('551151949395');
    expect(e.content.text).toBe('respondi pelo celular');
    expect(e.timestamp).toBe('1700000000');
  });

  it('nao mistura echo com mensagem inbound', () => {
    const res = adapter.parseWebhook(
      payload([
        { from: '551151949395', to: '5511988887777', id: 'wamid.E', timestamp: '1', type: 'text', text: { body: 'oi' } },
      ]) as any,
      { id: 'ch1', config: { phoneNumberId: 'PN1' } } as any,
    );
    expect(res.messages).toHaveLength(0);
    expect(res.statuses).toHaveLength(0);
  });

  it('descarta echo sem `to` (sem contraparte nao ha conversa)', () => {
    const res = adapter.parseWebhook(
      payload([{ from: '551151949395', id: 'wamid.X', timestamp: '1', type: 'text', text: { body: 'oi' } }]) as any,
      { id: 'ch1', config: { phoneNumberId: 'PN1' } } as any,
    );
    expect(res.messageEchoes ?? []).toHaveLength(0);
  });

  it('webhook sem echoes nao cria o campo', () => {
    const res = adapter.parseWebhook({ entry: [] } as any, { id: 'ch1', config: {} } as any);
    expect(res.messageEchoes).toBeUndefined();
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
