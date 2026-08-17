import * as crypto from 'crypto';
import { Channel } from '@prisma/client';
import { MessengerInboundAdapter } from './messenger.inbound-adapter';
import { MessengerMessageMapper } from './messenger.message-mapper';

const APP_SECRET = 'segredo-de-teste';

function makeChannel(config: Record<string, unknown>): Channel {
  return { id: 'ch_1', config } as unknown as Channel;
}

function sign(body: Buffer, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('MessengerInboundAdapter', () => {
  const adapter = new MessengerInboundAdapter(new MessengerMessageMapper());

  it('extrai o Page ID de cada entry, sem repetir', () => {
    const locators = adapter.extractLocators({
      object: 'page',
      entry: [{ id: 'PAGE_1' }, { id: 'PAGE_1' }, { id: 'PAGE_2' }],
    });

    expect(locators).toEqual([{ pageId: 'PAGE_1' }, { pageId: 'PAGE_2' }]);
  });

  it('casa o canal pelo pageId da config', () => {
    expect(adapter.matchesChannel(makeChannel({ pageId: 'PAGE_1' }), { pageId: 'PAGE_1' })).toBe(true);
    expect(adapter.matchesChannel(makeChannel({ pageId: 'PAGE_9' }), { pageId: 'PAGE_1' })).toBe(false);
  });

  it('nao casa quando o locator vem sem pageId', () => {
    expect(adapter.matchesChannel(makeChannel({ pageId: 'PAGE_1' }), {})).toBe(false);
  });

  it('extrai mensagens do envelope', () => {
    const result = adapter.parseWebhook(
      {
        object: 'page',
        entry: [
          {
            id: 'PAGE_1',
            messaging: [
              {
                sender: { id: 'PSID_1' },
                recipient: { id: 'PAGE_1' },
                timestamp: 1458692752478,
                message: { mid: 'm_1', text: 'oi' },
              },
            ],
          },
        ],
      },
      makeChannel({ pageId: 'PAGE_1' }),
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].externalMessageId).toBe('m_1');
    expect(result.errors).toHaveLength(0);
  });

  it('descarta entry de outra Pagina', () => {
    const result = adapter.parseWebhook(
      {
        object: 'page',
        entry: [
          {
            id: 'PAGE_OUTRA',
            messaging: [
              {
                sender: { id: 'PSID_1' },
                recipient: { id: 'PAGE_OUTRA' },
                timestamp: 1,
                message: { mid: 'm_x', text: 'nao e minha' },
              },
            ],
          },
        ],
      },
      makeChannel({ pageId: 'PAGE_1' }),
    );

    expect(result.messages).toHaveLength(0);
  });

  it('extrai status de entrega e leitura', () => {
    const result = adapter.parseWebhook(
      {
        object: 'page',
        entry: [
          {
            id: 'PAGE_1',
            messaging: [
              { sender: { id: 'PSID_1' }, timestamp: 1, delivery: { mids: ['m_1'] } },
              { sender: { id: 'PSID_1' }, timestamp: 2, read: { watermark: 1458692752478 } },
            ],
          },
        ],
      },
      makeChannel({ pageId: 'PAGE_1' }),
    );

    expect(result.statuses).toHaveLength(2);
  });

  it('nao estoura com payload malformado', () => {
    const result = adapter.parseWebhook({ entry: 'isso nao e array' }, makeChannel({ pageId: 'PAGE_1' }));

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.messages).toHaveLength(0);
  });

  // Cobertura adicional (nao estava nos Steps do plano): garante que o
  // adapter realmente usa o `meta-shared` para validar assinatura/handshake,
  // em vez de aceitar tudo. Espelha `instagram.inbound-adapter.spec.ts`.
  describe('validateWebhook', () => {
    it('aceita assinatura correta', () => {
      const body = Buffer.from('{"object":"page"}');
      const headers = { 'x-hub-signature-256': sign(body, APP_SECRET) };

      expect(
        adapter.validateWebhook(headers, body, undefined, makeChannel({ appSecret: APP_SECRET })),
      ).toBe(true);
    });

    it('recusa assinatura de outro segredo', () => {
      const body = Buffer.from('{"object":"page"}');
      const headers = { 'x-hub-signature-256': sign(body, 'outro-segredo') };

      expect(
        adapter.validateWebhook(headers, body, undefined, makeChannel({ appSecret: APP_SECRET })),
      ).toBe(false);
    });

    it('recusa quando o header nao veio', () => {
      const body = Buffer.from('{}');

      expect(
        adapter.validateWebhook({}, body, undefined, makeChannel({ appSecret: APP_SECRET })),
      ).toBe(false);
    });

    it('aceita sem validar quando o canal nao tem appSecret', () => {
      const body = Buffer.from('{}');

      expect(adapter.validateWebhook({}, body, undefined, makeChannel({}))).toBe(true);
    });
  });

  describe('handleVerification', () => {
    it('devolve o challenge quando o token bate', () => {
      const res = adapter.handleVerification(
        { 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '12345' },
        'tok',
      );

      expect(res).toEqual({ statusCode: 200, body: '12345' });
    });

    it('recusa quando o token nao bate', () => {
      const res = adapter.handleVerification(
        { 'hub.mode': 'subscribe', 'hub.verify_token': 'errado', 'hub.challenge': '12345' },
        'tok',
      );

      expect(res.statusCode).toBe(403);
    });
  });
});
