import { ChannelType } from '@prisma/client';
import { WasenderMessageMapper } from './wasender.message-mapper';
import {
  MessageContentType,
  NormalizedOutboundMessage,
} from '../../ports/types';

describe('WasenderMessageMapper', () => {
  const mapper = new WasenderMessageMapper();

  const wrap = (message: any, extra: any = {}) => ({
    event: 'messages.upsert',
    sessionId: 's1',
    data: {
      messages: {
        key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: 'ABC' },
        message,
        messageTimestamp: 1700000000,
        pushName: 'Cliente',
        ...extra,
      },
    },
  });

  describe('normalizeInbound', () => {
    it('normaliza texto simples (conversation)', () => {
      const r = mapper.normalizeInbound(wrap({ conversation: 'Olá' }));
      expect(r).not.toBeNull();
      expect(r!.channelType).toBe(ChannelType.WHATSAPP_WASENDER);
      expect(r!.type).toBe(MessageContentType.TEXT);
      expect(r!.content.text).toBe('Olá');
      expect(r!.externalMessageId).toBe('ABC');
      expect(r!.externalContactId).toBe('5511999999999@s.whatsapp.net');
      expect(r!.contactPhone).toBe('5511999999999');
      expect(r!.contactName).toBe('Cliente');
      expect(r!.isEcho).toBe(false);
      expect(r!.isGroup).toBe(false);
    });

    it('normaliza extendedTextMessage', () => {
      const r = mapper.normalizeInbound(
        wrap({ extendedTextMessage: { text: 'com contexto' } }),
      );
      expect(r!.type).toBe(MessageContentType.TEXT);
      expect(r!.content.text).toBe('com contexto');
    });

    it('normaliza imagem com legenda e mimetype', () => {
      const r = mapper.normalizeInbound(
        wrap({
          imageMessage: {
            url: 'https://cdn/x.enc',
            mimetype: 'image/jpeg',
            caption: 'foto',
            fileLength: '1234',
          },
        }),
      );
      expect(r!.type).toBe(MessageContentType.IMAGE);
      expect(r!.content.mediaUrl).toBe('https://cdn/x.enc');
      expect(r!.content.mimeType).toBe('image/jpeg');
      expect(r!.content.caption).toBe('foto');
      expect(r!.content.fileSize).toBe(1234);
    });

    it('marca echo quando fromMe=true e não usa pushName como nome do contato', () => {
      const ev = wrap({ conversation: 'oi' });
      ev.data.messages.key.fromMe = true;
      const r = mapper.normalizeInbound(ev);
      expect(r!.isEcho).toBe(true);
      expect(r!.contactName).toBeUndefined();
    });

    it('detecta grupo pelo sufixo @g.us', () => {
      const ev = wrap({ conversation: 'oi grupo' });
      ev.data.messages.key.remoteJid = '123456@g.us';
      const r = mapper.normalizeInbound(ev);
      expect(r!.isGroup).toBe(true);
      expect(r!.contactPhone).toBeUndefined();
    });

    it('captura replyTo via contextInfo.stanzaId', () => {
      const r = mapper.normalizeInbound(
        wrap({
          extendedTextMessage: {
            text: 'resposta',
            contextInfo: { stanzaId: 'PARENT1' },
          },
        }),
      );
      expect(r!.replyTo?.externalMessageId).toBe('PARENT1');
    });

    it('resolve o telefone real via senderPn quando remoteJid é @lid', () => {
      const r = mapper.normalizeInbound({
        event: 'messages.upsert',
        data: {
          messages: {
            key: {
              id: 'M9',
              fromMe: false,
              remoteJid: '34067764523057@lid',
              senderPn: '14074218779@s.whatsapp.net',
              cleanedSenderPn: '14074218779',
            },
            message: { conversation: 'oi' },
            messageTimestamp: 1700000000,
            pushName: 'Cliente',
          },
        },
      });
      // externalContactId precisa ser o JID de telefone (enviável), não o @lid
      expect(r!.externalContactId).toBe('14074218779@s.whatsapp.net');
      expect(r!.contactPhone).toBe('14074218779');
    });

    it('retorna null sem key', () => {
      expect(mapper.normalizeInbound({ event: 'x', data: {} })).toBeNull();
    });
  });

  describe('normalizeStatus', () => {
    const status = (raw: any) => ({
      event: 'messages.update',
      data: { key: { id: 'MID' }, update: { status: raw }, messageTimestamp: 1700000000 },
    });

    it('mapeia status numérico do Baileys', () => {
      expect(mapper.normalizeStatus(status(2))!.status).toBe('sent');
      expect(mapper.normalizeStatus(status(3))!.status).toBe('delivered');
      expect(mapper.normalizeStatus(status(4))!.status).toBe('read');
    });

    it('mapeia status em string', () => {
      expect(mapper.normalizeStatus(status('READ'))!.status).toBe('read');
      expect(mapper.normalizeStatus(status('DELIVERED'))!.status).toBe('delivered');
    });

    it('retorna null para status desconhecido ou sem id', () => {
      expect(mapper.normalizeStatus(status(99))).toBeNull();
      expect(mapper.normalizeStatus({ data: { update: { status: 3 } } })).toBeNull();
    });
  });

  describe('denormalize', () => {
    const jid = '5511999999999@s.whatsapp.net';
    const out = (
      type: MessageContentType,
      content: any,
    ): NormalizedOutboundMessage => ({ type, content });

    it('texto → { to, text }', () => {
      const { endpoint, payload } = mapper.denormalize(
        out(MessageContentType.TEXT, { text: 'oi' }),
        jid,
      );
      expect(endpoint).toBe('/send-message');
      expect(payload).toEqual({ to: '5511999999999', text: 'oi' });
    });

    it('imagem → { to, imageUrl, text? }', () => {
      const { payload } = mapper.denormalize(
        out(MessageContentType.IMAGE, { mediaUrl: 'https://x/a.jpg', caption: 'leg' }),
        jid,
      );
      expect(payload.imageUrl).toBe('https://x/a.jpg');
      expect(payload.text).toBe('leg');
      expect(payload.to).toBe('5511999999999');
    });

    it('áudio → { to, audioUrl }', () => {
      const { payload } = mapper.denormalize(
        out(MessageContentType.AUDIO, { mediaUrl: 'https://x/a.ogg' }),
        jid,
      );
      expect(payload).toEqual({ to: '5511999999999', audioUrl: 'https://x/a.ogg' });
    });

    it('documento → { to, documentUrl, fileName }', () => {
      const { payload } = mapper.denormalize(
        out(MessageContentType.DOCUMENT, {
          mediaUrl: 'https://x/a.pdf',
          fileName: 'contrato.pdf',
        }),
        jid,
      );
      expect(payload.documentUrl).toBe('https://x/a.pdf');
      expect(payload.fileName).toBe('contrato.pdf');
    });
  });
});
