import { Channel, ChannelType } from '@prisma/client';
import { WasenderInboundAdapter } from './wasender.inbound-adapter';
import { WasenderMessageMapper } from './wasender.message-mapper';

const channel = (overrides: Partial<Channel> = {}): Channel =>
  ({
    id: 'c1',
    organizationId: 'o1',
    type: ChannelType.WHATSAPP_WASENDER,
    name: 'Wasender',
    config: { sessionId: 'sess-1', sessionApiKey: 'k', personalToken: 'p' },
    webhookSecret: 'top-secret',
    isActive: true,
    ...overrides,
  }) as Channel;

describe('WasenderInboundAdapter', () => {
  const adapter = new WasenderInboundAdapter(new WasenderMessageMapper());

  describe('extractLocators', () => {
    it('extrai sessionId do payload e assinatura do header', () => {
      const [loc] = adapter.extractLocators(
        { sessionId: 'sess-1' },
        { 'x-webhook-signature': 'top-secret' },
      );
      expect(loc.instanceId).toBe('sess-1');
      expect(loc.token).toBe('top-secret');
    });
  });

  describe('matchesChannel', () => {
    it('casa por sessionId', () => {
      expect(adapter.matchesChannel(channel(), { instanceId: 'sess-1' })).toBe(true);
      expect(adapter.matchesChannel(channel(), { instanceId: 'outra' })).toBe(false);
    });

    it('casa pela assinatura == webhookSecret quando não há sessionId', () => {
      expect(adapter.matchesChannel(channel(), { token: 'top-secret' })).toBe(true);
      expect(adapter.matchesChannel(channel(), { token: 'errado' })).toBe(false);
    });

    it('recusa quando não há como distinguir', () => {
      expect(
        adapter.matchesChannel(channel({ webhookSecret: null }), {}),
      ).toBe(false);
    });
  });

  describe('validateWebhook', () => {
    const body = Buffer.from('{}');

    it('aceita assinatura correta', () => {
      expect(
        adapter.validateWebhook(
          { 'x-webhook-signature': 'top-secret' },
          body,
          'top-secret',
        ),
      ).toBe(true);
    });

    it('rejeita assinatura incorreta', () => {
      expect(
        adapter.validateWebhook(
          { 'x-webhook-signature': 'errado' },
          body,
          'top-secret',
        ),
      ).toBe(false);
    });

    it('rejeita quando secret configurado mas header ausente', () => {
      expect(adapter.validateWebhook({}, body, 'top-secret')).toBe(false);
    });

    it('aceita quando não há webhookSecret configurado (roteado por sessionId)', () => {
      expect(adapter.validateWebhook({}, body, undefined)).toBe(true);
    });
  });

  describe('parseWebhook', () => {
    it('extrai mensagem de messages.upsert', () => {
      const r = adapter.parseWebhook({
        event: 'messages.upsert',
        data: {
          messages: {
            key: { remoteJid: '55119@s.whatsapp.net', fromMe: false, id: 'M1' },
            message: { conversation: 'oi' },
            messageTimestamp: 1700000000,
          },
        },
      });
      expect(r.messages).toHaveLength(1);
      expect(r.statuses).toHaveLength(0);
      expect(r.messages[0].externalMessageId).toBe('M1');
    });

    it('extrai status de messages.update', () => {
      const r = adapter.parseWebhook({
        event: 'messages.update',
        data: { key: { id: 'M1' }, update: { status: 4 } },
      });
      expect(r.statuses).toHaveLength(1);
      expect(r.statuses[0].status).toBe('read');
    });

    it('ignora eventos não mapeados (ex: session.status)', () => {
      const r = adapter.parseWebhook({ event: 'session.status', data: {} });
      expect(r.messages).toHaveLength(0);
      expect(r.statuses).toHaveLength(0);
      expect(r.errors).toHaveLength(0);
    });
  });
});
