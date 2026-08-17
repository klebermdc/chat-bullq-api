import { Channel } from '@prisma/client';
import { MessengerOutboundAdapter } from './messenger.outbound-adapter';
import { MessengerMessageMapper } from './messenger.message-mapper';
import { MessengerHttpClient } from './messenger.http-client';
import { MessageContentType } from '../../ports/types';

function makeChannel(): Channel {
  return { id: 'ch_1', config: {} } as unknown as Channel;
}

describe('MessengerOutboundAdapter', () => {
  let httpClient: jest.Mocked<Pick<MessengerHttpClient, 'sendMessage' | 'downloadMedia'>>;
  let adapter: MessengerOutboundAdapter;

  beforeEach(() => {
    httpClient = {
      sendMessage: jest.fn(),
      downloadMedia: jest.fn(),
    };
    adapter = new MessengerOutboundAdapter(
      new MessengerMessageMapper(),
      httpClient as unknown as MessengerHttpClient,
    );
  });

  describe('sendMessage', () => {
    it('envia o payload denormalizado e devolve o externalId da Meta', async () => {
      httpClient.sendMessage.mockResolvedValue({ message_id: 'mid.123', recipient_id: 'PSID_1' });

      const result = await adapter.sendMessage(makeChannel(), 'PSID_1', {
        type: MessageContentType.TEXT,
        content: { text: 'oi' },
      });

      expect(httpClient.sendMessage).toHaveBeenCalledWith(
        makeChannel(),
        expect.objectContaining({
          recipient: { id: 'PSID_1' },
          message: { text: 'oi' },
        }),
      );
      expect(result.externalId).toBe('mid.123');
      expect(result.providerResponse).toEqual({ message_id: 'mid.123', recipient_id: 'PSID_1' });
    });

    it('devolve externalId vazio quando a Meta nao manda message_id', async () => {
      httpClient.sendMessage.mockResolvedValue({});

      const result = await adapter.sendMessage(makeChannel(), 'PSID_1', {
        type: MessageContentType.TEXT,
        content: { text: 'oi' },
      });

      expect(result.externalId).toBe('');
    });

    // Bug real deste projeto (API #154): o `failedReason` gravava
    // "Request failed with status code 400" em vez do motivo que a Meta
    // devolveu. O client (`messenger.http-client.ts`) já resolve isso
    // lançando um Error com a mensagem real — este teste garante que o
    // adapter NÃO intercepta e substitui esse erro por um genérico no
    // caminho de volta pro service que grava o `failedReason`.
    it('propaga o motivo real do erro da Meta sem mascarar', async () => {
      httpClient.sendMessage.mockRejectedValue(
        new Error('Messenger sendMessage falhou: This person is not available right now (code=551, subcode=n/a)'),
      );

      await expect(
        adapter.sendMessage(makeChannel(), 'PSID_1', {
          type: MessageContentType.TEXT,
          content: { text: 'oi' },
        }),
      ).rejects.toThrow('This person is not available right now (code=551, subcode=n/a)');
    });
  });

  describe('sendTypingIndicator', () => {
    it('manda sender_action typing_on pro PSID', async () => {
      httpClient.sendMessage.mockResolvedValue({});

      await adapter.sendTypingIndicator(makeChannel(), 'PSID_1');

      expect(httpClient.sendMessage).toHaveBeenCalledWith(makeChannel(), {
        recipient: { id: 'PSID_1' },
        sender_action: 'typing_on',
      });
    });

    it('nunca lanca: falha do indicador nao pode derrubar o envio', async () => {
      httpClient.sendMessage.mockRejectedValue(new Error('boom'));

      await expect(adapter.sendTypingIndicator(makeChannel(), 'PSID_1')).resolves.toBeUndefined();
    });
  });

  describe('getMediaUrl', () => {
    it('devolve o mediaId sem transformar (Messenger ja manda URL jogavel)', async () => {
      await expect(adapter.getMediaUrl(makeChannel(), 'https://cdn.fbsbx.com/x.jpg')).resolves.toBe(
        'https://cdn.fbsbx.com/x.jpg',
      );
    });
  });

  describe('downloadMedia', () => {
    it('delega pro http client', async () => {
      const buf = Buffer.from('conteudo');
      httpClient.downloadMedia.mockResolvedValue(buf);

      const result = await adapter.downloadMedia(makeChannel(), 'https://cdn.fbsbx.com/x.jpg');

      expect(httpClient.downloadMedia).toHaveBeenCalledWith('https://cdn.fbsbx.com/x.jpg');
      expect(result).toBe(buf);
    });
  });

  describe('deleteMessage', () => {
    it('sempre rejeita: a Meta nao permite apagar mensagens do Messenger via API', async () => {
      await expect(adapter.deleteMessage!(makeChannel(), 'mid.123')).rejects.toThrow(/mid\.123/);
    });
  });

  describe('getRateLimits', () => {
    it('devolve os limites do Graph API', () => {
      expect(adapter.getRateLimits()).toEqual({
        maxPerSecond: 200,
        maxPerMinute: 5000,
        windowMs: 60000,
      });
    });
  });
});
