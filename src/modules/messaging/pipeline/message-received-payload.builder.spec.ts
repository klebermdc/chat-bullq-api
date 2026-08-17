import { buildMessageReceivedPayload } from './message-received-payload.builder';
import {
  NormalizedInboundMessage,
  MessageContentType,
} from '../../channel-hub/ports/types';
import { ChannelType } from '@prisma/client';

const base = {
  organizationId: 'org-1',
  contactId: 'contact-1',
  conversationId: 'conv-1',
  channelId: 'chan-1',
  messageId: 'msg-1',
};

function message(over: Partial<NormalizedInboundMessage> = {}): NormalizedInboundMessage {
  return {
    externalMessageId: 'ext-1',
    externalContactId: 'ext-contact-1',
    channelType: ChannelType.WHATSAPP_OFFICIAL,
    timestamp: new Date('2026-08-17T12:00:00Z'),
    type: MessageContentType.TEXT,
    content: { text: 'oi' },
    rawPayload: {},
    ...over,
  };
}

describe('buildMessageReceivedPayload', () => {
  it('usa o texto como body', () => {
    const p = buildMessageReceivedPayload({ ...base, message: message() });
    expect(p.body).toBe('oi');
    expect(p.hasAttachment).toBe(false);
    expect(p.isFromCustomer).toBe(true);
  });

  it('cai na caption quando nao ha texto', () => {
    const p = buildMessageReceivedPayload({
      ...base,
      message: message({
        type: MessageContentType.IMAGE,
        content: { caption: 'olha isso' },
      }),
    });
    expect(p.body).toBe('olha isso');
    expect(p.hasAttachment).toBe(true);
  });

  it('devolve body null quando nao ha texto nem caption', () => {
    const p = buildMessageReceivedPayload({
      ...base,
      message: message({ type: MessageContentType.AUDIO, content: {} }),
    });
    expect(p.body).toBeNull();
    expect(p.hasAttachment).toBe(true);
  });

  it('propaga os ids recebidos', () => {
    const p = buildMessageReceivedPayload({ ...base, message: message() });
    expect(p.organizationId).toBe('org-1');
    expect(p.contactId).toBe('contact-1');
    expect(p.conversationId).toBe('conv-1');
    expect(p.channelId).toBe('chan-1');
    expect(p.messageId).toBe('msg-1');
    expect(p.type).toBe('TEXT');
  });

  it('prioriza texto mesmo quando ha caption', () => {
    const p = buildMessageReceivedPayload({
      ...base,
      message: message({ content: { text: 'texto', caption: 'legenda' } }),
    });
    expect(p.body).toBe('texto');
  });

  it.each([
    MessageContentType.IMAGE,
    MessageContentType.AUDIO,
    MessageContentType.VIDEO,
    MessageContentType.DOCUMENT,
    MessageContentType.STICKER,
  ])('marca hasAttachment para o tipo %s', (type) => {
    const p = buildMessageReceivedPayload({
      ...base,
      message: message({ type, content: {} }),
    });
    expect(p.hasAttachment).toBe(true);
  });
});
