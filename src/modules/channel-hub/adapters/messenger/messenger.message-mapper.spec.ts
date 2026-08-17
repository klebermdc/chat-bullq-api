import { ChannelType } from '@prisma/client';
import { MessengerMessageMapper } from './messenger.message-mapper';
import { MessageContentType } from '../../ports/types';

describe('MessengerMessageMapper.normalizeInbound', () => {
  const mapper = new MessengerMessageMapper();

  it('normaliza mensagem de texto', () => {
    const result = mapper.normalizeInbound({
      sender: { id: 'PSID_1' },
      recipient: { id: 'PAGE_1' },
      timestamp: 1458692752478,
      message: { mid: 'm_abc', text: 'ola mundo' },
    });

    expect(result).toMatchObject({
      externalMessageId: 'm_abc',
      externalContactId: 'PSID_1',
      channelType: ChannelType.MESSENGER,
      type: MessageContentType.TEXT,
      content: { text: 'ola mundo' },
      isEcho: false,
    });
  });

  it('devolve null quando nao ha mensagem no evento', () => {
    expect(
      mapper.normalizeInbound({ sender: { id: 'PSID_1' }, recipient: { id: 'PAGE_1' } }),
    ).toBeNull();
  });

  it('em echo, o contato e o destinatario e nao o remetente', () => {
    const result = mapper.normalizeInbound({
      sender: { id: 'PAGE_1' },
      recipient: { id: 'PSID_1' },
      timestamp: 1458692752478,
      message: { mid: 'm_echo', text: 'resposta do atendente', is_echo: true },
    });

    expect(result?.externalContactId).toBe('PSID_1');
    expect(result?.isEcho).toBe(true);
  });

  it('normaliza imagem', () => {
    const result = mapper.normalizeInbound({
      sender: { id: 'PSID_1' },
      recipient: { id: 'PAGE_1' },
      timestamp: 1458692752478,
      message: {
        mid: 'm_img',
        attachments: [{ type: 'image', payload: { url: 'https://cdn.meta/x.jpg' } }],
      },
    });

    expect(result?.type).toBe(MessageContentType.IMAGE);
    expect(result?.content.mediaUrl).toBe('https://cdn.meta/x.jpg');
  });

  it('trata figurinha no formato de transicao (sticker + image juntos)', () => {
    const result = mapper.normalizeInbound({
      sender: { id: 'PSID_1' },
      recipient: { id: 'PAGE_1' },
      timestamp: 1458692752478,
      message: {
        mid: 'm_stk',
        attachments: [
          { type: 'image', payload: { url: 'https://cdn.meta/s.png', sticker_id: 369239263222822 } },
          { type: 'sticker', payload: { url: 'https://cdn.meta/s.png', sticker_id: 369239263222822 } },
        ],
      },
    });

    expect(result?.type).toBe(MessageContentType.STICKER);
    expect(result?.content.mediaUrl).toBe('https://cdn.meta/s.png');
  });

  it('trata figurinha no formato pos-transicao (so sticker)', () => {
    const result = mapper.normalizeInbound({
      sender: { id: 'PSID_1' },
      recipient: { id: 'PAGE_1' },
      timestamp: 1458692752478,
      message: {
        mid: 'm_stk2',
        attachments: [{ type: 'sticker', payload: { url: 'https://cdn.meta/s.png' } }],
      },
    });

    expect(result?.type).toBe(MessageContentType.STICKER);
  });

  it('normaliza resposta de quick reply como INTERACTIVE', () => {
    const result = mapper.normalizeInbound({
      sender: { id: 'PSID_1' },
      recipient: { id: 'PAGE_1' },
      timestamp: 1458692752478,
      message: { mid: 'm_qr', text: 'Quero sim', quick_reply: { payload: 'SIM_QUERO' } },
    });

    expect(result?.type).toBe(MessageContentType.INTERACTIVE);
    expect(result?.content.interactive).toEqual({ type: 'quick_reply', payload: 'SIM_QUERO' });
    expect(result?.content.text).toBe('Quero sim');
  });

  it('normaliza compartilhamento de link (share) usando a url do payload', () => {
    const result = mapper.normalizeInbound({
      sender: { id: 'PSID_1' },
      recipient: { id: 'PAGE_1' },
      timestamp: 1458692752478,
      message: {
        mid: 'm_share',
        attachments: [{ type: 'share', payload: { url: 'https://exemplo.com/produto' } }],
      },
    });

    expect(result?.type).toBe(MessageContentType.TEXT);
    expect(result?.content.text).toBe('https://exemplo.com/produto');
  });

  it('normaliza template (generic) como TEMPLATE com elementos e botoes', () => {
    const result = mapper.normalizeInbound({
      sender: { id: 'PSID_1' },
      recipient: { id: 'PAGE_1' },
      timestamp: 1458692752478,
      message: {
        mid: 'm_tpl',
        attachments: [
          {
            type: 'template',
            payload: {
              template_type: 'generic',
              elements: [
                {
                  title: 'Produto X',
                  subtitle: 'Confira nossa oferta',
                  buttons: [{ type: 'web_url', title: 'Ver mais', url: 'https://exemplo.com' }],
                },
              ],
            },
          },
        ],
      },
    });

    expect(result?.type).toBe(MessageContentType.TEMPLATE);
    expect(result?.content.template?.templateType).toBe('generic');
    expect(result?.content.template?.elements?.[0]).toMatchObject({
      title: 'Produto X',
      subtitle: 'Confira nossa oferta',
    });
    expect(result?.content.template?.elements?.[0].buttons?.[0]).toMatchObject({
      type: 'web_url',
      title: 'Ver mais',
      url: 'https://exemplo.com',
    });
  });

  it('guarda o mid citado quando a mensagem e resposta a outra', () => {
    const result = mapper.normalizeInbound({
      sender: { id: 'PSID_1' },
      recipient: { id: 'PAGE_1' },
      timestamp: 1458692752478,
      message: { mid: 'm_reply', text: 'isso', reply_to: { mid: 'm_original' } },
    });

    expect(result?.replyTo).toEqual({ externalMessageId: 'm_original' });
  });
});
