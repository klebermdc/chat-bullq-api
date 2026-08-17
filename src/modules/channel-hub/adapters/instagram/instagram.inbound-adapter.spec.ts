import * as crypto from 'crypto';
import { Channel } from '@prisma/client';
import { InstagramInboundAdapter } from './instagram.inbound-adapter';
import { InstagramMessageMapper } from './instagram.message-mapper';

const APP_SECRET = 'segredo-de-teste';

function makeChannel(config: Record<string, unknown>): Channel {
  return { id: 'ch_1', config } as unknown as Channel;
}

function sign(body: Buffer, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('InstagramInboundAdapter (caracterização)', () => {
  const adapter = new InstagramInboundAdapter(new InstagramMessageMapper());

  describe('validateWebhook', () => {
    it('aceita assinatura correta', () => {
      const body = Buffer.from('{"object":"instagram"}');
      const headers = { 'x-hub-signature-256': sign(body, APP_SECRET) };

      expect(
        adapter.validateWebhook(headers, body, undefined, makeChannel({ appSecret: APP_SECRET })),
      ).toBe(true);
    });

    it('recusa assinatura de outro segredo', () => {
      const body = Buffer.from('{"object":"instagram"}');
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
