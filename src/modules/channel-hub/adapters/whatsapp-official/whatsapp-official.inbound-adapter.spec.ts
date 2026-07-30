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
                metadata: { display_phone_number: '551151949395', phone_number_id: 'PN1' },
                message_echoes: echoes,
              },
            },
          ],
        },
      ],
    };
  }

  const ch = { id: 'ch1', config: { phoneNumberId: 'PN1' } } as any;

  it('usa o `to` como contato — quem fala no echo e o NEGOCIO', () => {
    const res = adapter.parseWebhook(
      payload([
        {
          from: '551151949395',   // numero do NEGOCIO
          to: '5511988887777',    // numero do CLIENTE
          id: 'wamid.ECHO1',
          timestamp: '1700000000',
          type: 'text',
          text: { body: 'respondi pelo celular' },
        },
      ]) as any,
      ch,
    );

    expect(res.messages).toHaveLength(1);
    const m = res.messages[0];
    expect(m.externalMessageId).toBe('wamid.ECHO1');
    // Se invertermos from/to, o echo cai na conversa errada.
    expect(m.externalContactId).toBe('5511988887777');
    expect(m.content.text).toBe('respondi pelo celular');
  });

  it('marca isEcho E isHumanEcho — so a coexistencia garante que foi humano', () => {
    const res = adapter.parseWebhook(
      payload([
        { from: '551151949395', to: '5511988887777', id: 'wamid.E', timestamp: '1', type: 'text', text: { body: 'oi' } },
      ]) as any,
      ch,
    );
    expect(res.messages[0].isEcho).toBe(true);
    expect(res.messages[0].isHumanEcho).toBe(true);
  });

  it('descarta echo sem `to` (sem contraparte nao ha conversa)', () => {
    const res = adapter.parseWebhook(
      payload([{ from: '551151949395', id: 'wamid.X', timestamp: '1', type: 'text', text: { body: 'oi' } }]) as any,
      ch,
    );
    expect(res.messages).toHaveLength(0);
  });

  it('mensagem inbound normal NAO vira echo', () => {
    const res = adapter.parseWebhook(
      {
        entry: [
          {
            id: 'WABA1',
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: 'PN1' },
                  contacts: [{ wa_id: '5511988887777' }],
                  messages: [
                    { id: 'wamid.IN', from: '5511988887777', timestamp: '1', type: 'text', text: { body: 'oi' } },
                  ],
                },
              },
            ],
          },
        ],
      } as any,
      ch,
    );
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0].isEcho).toBeFalsy();
    expect(res.messages[0].isHumanEcho).toBeFalsy();
  });
});

describe('WhatsAppOfficialInboundAdapter.parseWebhook — history (coexistência)', () => {
  const adapter = new WhatsAppOfficialInboundAdapter(
    new WhatsAppOfficialMessageMapper(),
    new WhatsAppPlatformConfigService(),
  );
  const ch = { id: 'ch1', config: { phoneNumberId: 'PN1' } } as any;

  function hist(value: any) {
    return { entry: [{ id: 'WABA1', changes: [{ field: 'history', value }] }] };
  }

  it('separa msg do NEGOCIO da msg do CLIENTE pelo display_phone_number', () => {
    const res = adapter.parseWebhook(
      hist({
        metadata: { display_phone_number: '551151949395', phone_number_id: 'PN1' },
        history: [
          {
            metadata: { phase: 'PHASE_1', chunk_order: 0, progress: 50 },
            threads: [
              {
                id: '5511988887777',
                messages: [
                  { from: '5511988887777', to: '551151949395', id: 'm1', timestamp: '1700000000', type: 'text', text: { body: 'cliente' } },
                  { from: '551151949395', to: '5511988887777', id: 'm2', timestamp: '1700000001', type: 'text', text: { body: 'negocio' } },
                ],
              },
            ],
          },
        ],
      }) as any,
      ch,
    );

    expect(res.historyChunks).toHaveLength(1);
    const c = res.historyChunks![0];
    expect(c.phase).toBe('PHASE_1');
    expect(c.chunkOrder).toBe(0);
    expect(c.progress).toBe(50);
    expect(c.threads[0].contactPhone).toBe('5511988887777');
    expect(c.threads[0].messages[0].fromBusiness).toBe(false);
    expect(c.threads[0].messages[1].fromBusiness).toBe(true);
  });

  it('recusa do cliente (so errors, sem history) vira chunk com erro', () => {
    const res = adapter.parseWebhook(
      hist({
        metadata: { phone_number_id: 'PN1' },
        errors: [{ code: 2593109, message: 'History sync is turned off' }],
      }) as any,
      ch,
    );
    expect(res.historyChunks).toHaveLength(1);
    expect(res.historyChunks![0].error?.code).toBe(2593109);
    expect(res.historyChunks![0].threads).toHaveLength(0);
  });

  it('nao contamina o fluxo de mensagem normal', () => {
    const res = adapter.parseWebhook(
      hist({
        metadata: { display_phone_number: '551151949395', phone_number_id: 'PN1' },
        history: [{ metadata: {}, threads: [{ id: '5511988887777', messages: [{ from: '5511988887777', id: 'm1', timestamp: '1', type: 'text', text: { body: 'x' } }] }] }],
      }) as any,
      ch,
    );
    expect(res.messages).toHaveLength(0);
  });
});

describe('WhatsAppOfficialInboundAdapter — escopo por phone_number_id', () => {
  const adapter = new WhatsAppOfficialInboundAdapter(
    new WhatsAppOfficialMessageMapper(),
    new WhatsAppPlatformConfigService(),
  );
  // Canal do numero A; o lote traz evento do numero B da MESMA WABA.
  const chA = { id: 'chA', config: { phoneNumberId: 'PN_A' } } as any;

  function change(field: string, extra: any) {
    return {
      entry: [{ id: 'WABA1', changes: [{ field, value: { metadata: { phone_number_id: 'PN_B' }, ...extra } }] }],
    };
  }

  it('descarta echo de OUTRO numero da mesma WABA', () => {
    const res = adapter.parseWebhook(
      change('smb_message_echoes', {
        message_echoes: [{ from: 'X', to: '5511999', id: 'm1', timestamp: '1', type: 'text', text: { body: 'oi' } }],
      }) as any,
      chA,
    );
    expect(res.messages).toHaveLength(0);
  });

  it('descarta historico de OUTRO numero da mesma WABA', () => {
    const res = adapter.parseWebhook(
      change('history', {
        history: [{ metadata: {}, threads: [{ id: '5511999', messages: [{ from: '5511999', id: 'm1', timestamp: '1', type: 'text', text: { body: 'x' } }] }] }],
      }) as any,
      chA,
    );
    expect(res.historyChunks).toBeUndefined();
  });

  it('descarta contato de OUTRO numero da mesma WABA', () => {
    const res = adapter.parseWebhook(
      change('smb_app_state_sync', {
        state_sync: [{ type: 'contact', contact: { phone_number: '5511999', full_name: 'X' }, action: 'add' }],
      }) as any,
      chA,
    );
    expect(res.contactSyncs).toBeUndefined();
  });

  // account_update e evento de CONTA: nao carrega phone_number_id e NAO pode
  // ser descartado pelo escopo, senao o aviso de banimento nunca chega.
  it('NAO descarta account_update, que e evento de conta sem numero', () => {
    const res = adapter.parseWebhook(
      { entry: [{ id: 'WABA1', changes: [{ field: 'account_update', value: { event: 'PARTNER_REMOVED' } }] }] } as any,
      chA,
    );
    expect(res.accountUpdates).toHaveLength(1);
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
