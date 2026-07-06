import { Injectable } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import {
  NormalizedInboundMessage,
  NormalizedOutboundMessage,
  MessageContentType,
  StatusUpdate,
} from '../../ports/types';

/**
 * O WasenderAPI é baseado em Baileys, então os eventos `messages.upsert` /
 * `messages.update` carregam a estrutura WAMessage do Baileys:
 *   { key: { remoteJid, fromMe, id }, message: { ... }, messageTimestamp, pushName }
 *
 * Este mapper traduz esse formato ↔ o formato normalizado interno, e monta o
 * payload do `POST /api/send-message` para o envio.
 */
@Injectable()
export class WasenderMessageMapper {
  /** Localiza o WAMessage dentro do envelope do webhook (shape varia). */
  private pickMessage(event: any): any | null {
    const data = event?.data ?? event;
    const candidate =
      data?.messages ?? data?.message ?? data?.msg ?? data;
    if (Array.isArray(candidate)) return candidate[0] ?? null;
    // Um WAMessage sempre tem `key`; se não tiver, não é uma mensagem.
    return candidate?.key ? candidate : null;
  }

  normalizeInbound(event: any): NormalizedInboundMessage | null {
    const msg = this.pickMessage(event);
    if (!msg || !msg.key) return null;

    const remoteJid: string = msg.key.remoteJid || '';
    const isGroup = remoteJid.endsWith('@g.us');
    const phone = remoteJid.replace(/@s\.whatsapp\.net|@g\.us|@lid/g, '');
    const isEcho = msg.key.fromMe === true;

    // Nome do contato:
    //  - Grupo: nome do grupo (subject) quando disponível.
    //  - 1-a-1 recebida: pushName é o contato → correto.
    //  - 1-a-1 echo (fromMe): pushName seríamos NÓS, não o contato → não usar.
    const groupSubject = event?.data?.subject || event?.subject;
    const resolvedContactName = isGroup
      ? groupSubject
      : isEcho
        ? undefined
        : msg.pushName || undefined;

    const result: NormalizedInboundMessage = {
      externalMessageId: msg.key.id || '',
      externalContactId: remoteJid,
      contactName: resolvedContactName,
      contactPhone: isGroup ? undefined : phone,
      channelType: ChannelType.WHATSAPP_WASENDER,
      timestamp: this.tsToDate(msg.messageTimestamp),
      type: this.resolveContentType(msg.message),
      content: this.extractContent(msg.message),
      isForwarded: this.isForwarded(msg.message),
      isGroup,
      isEcho,
      senderName: isGroup ? msg.pushName?.trim() || undefined : undefined,
      rawPayload: event,
    };

    const ctx = this.contextInfo(msg.message);
    if (ctx?.stanzaId) {
      result.replyTo = { externalMessageId: ctx.stanzaId };
    }

    return result;
  }

  /**
   * `messages.update` (Baileys) traz `update.status` numérico:
   *   0 ERROR, 1 PENDING, 2 SERVER_ACK(sent), 3 DELIVERY_ACK(delivered),
   *   4 READ, 5 PLAYED. Aceitamos também status em string.
   */
  normalizeStatus(event: any): StatusUpdate | null {
    const data = event?.data ?? event;
    const item = Array.isArray(data) ? data[0] : data;
    if (!item) return null;

    const id = item?.key?.id || item?.id || item?.messageId;
    if (!id) return null;

    const numericMap: Record<number, StatusUpdate['status']> = {
      1: 'sent',
      2: 'sent',
      3: 'delivered',
      4: 'read',
      5: 'read',
    };
    const stringMap: Record<string, StatusUpdate['status']> = {
      pending: 'sent',
      server_ack: 'sent',
      sent: 'sent',
      delivery_ack: 'delivered',
      delivered: 'delivered',
      read: 'read',
      played: 'read',
      error: 'failed',
      failed: 'failed',
    };

    const rawStatus = item?.update?.status ?? item?.status ?? item?.ack;
    let status: StatusUpdate['status'] | undefined;
    if (typeof rawStatus === 'number') {
      status = numericMap[rawStatus];
    } else if (typeof rawStatus === 'string') {
      status = stringMap[rawStatus.toLowerCase()];
    }
    if (!status) return null;

    return {
      externalMessageId: String(id),
      status,
      timestamp: this.tsToDate(item?.messageTimestamp),
    };
  }

  /**
   * Monta o payload do `POST /api/send-message`. O Wasender aceita `to`
   * (número com DDI, sem +, ou JID) + um campo por tipo de mídia
   * (`imageUrl`/`videoUrl`/`audioUrl`/`documentUrl`/`stickerUrl`) e `text`
   * pro corpo/legenda.
   */
  denormalize(
    message: NormalizedOutboundMessage,
    contactExternalId: string,
  ): { endpoint: string; payload: Record<string, any> } {
    const to = contactExternalId.replace(/@s\.whatsapp\.net|@g\.us|@lid/g, '');
    const endpoint = '/send-message';

    switch (message.type) {
      case MessageContentType.TEXT:
        return { endpoint, payload: { to, text: message.content.text ?? '' } };

      case MessageContentType.IMAGE:
        return {
          endpoint,
          payload: {
            to,
            imageUrl: message.content.mediaUrl,
            text: message.content.caption || undefined,
          },
        };

      case MessageContentType.VIDEO:
        return {
          endpoint,
          payload: {
            to,
            videoUrl: message.content.mediaUrl,
            text: message.content.caption || undefined,
          },
        };

      case MessageContentType.AUDIO:
        return {
          endpoint,
          payload: { to, audioUrl: message.content.mediaUrl },
        };

      case MessageContentType.DOCUMENT:
        return {
          endpoint,
          payload: {
            to,
            documentUrl: message.content.mediaUrl,
            fileName: message.content.fileName || undefined,
            text: message.content.caption || undefined,
          },
        };

      case MessageContentType.STICKER:
        return {
          endpoint,
          payload: { to, stickerUrl: message.content.mediaUrl },
        };

      case MessageContentType.LOCATION:
        return {
          endpoint,
          payload: {
            to,
            location: {
              latitude: message.content.latitude,
              longitude: message.content.longitude,
              name: message.content.text || undefined,
            },
          },
        };

      default:
        return { endpoint, payload: { to, text: message.content.text ?? '' } };
    }
  }

  // ─── helpers ────────────────────────────────────────────────────────

  private tsToDate(ts: any): Date {
    const num = typeof ts === 'string' ? parseInt(ts, 10) : Number(ts);
    if (!num || isNaN(num)) return new Date();
    // Baileys manda em segundos; toleramos milissegundos.
    return new Date(num > 9999999999 ? num : num * 1000);
  }

  private contextInfo(message: any): any | undefined {
    if (!message || typeof message !== 'object') return undefined;
    const holder =
      message.extendedTextMessage ||
      message.imageMessage ||
      message.videoMessage ||
      message.audioMessage ||
      message.documentMessage ||
      message.stickerMessage;
    return holder?.contextInfo;
  }

  private isForwarded(message: any): boolean {
    const ctx = this.contextInfo(message);
    return !!ctx && (ctx.isForwarded === true || (ctx.forwardingScore ?? 0) > 0);
  }

  private resolveContentType(message: any): MessageContentType {
    if (!message || typeof message !== 'object') return MessageContentType.TEXT;
    if (message.conversation || message.extendedTextMessage)
      return MessageContentType.TEXT;
    if (message.imageMessage) return MessageContentType.IMAGE;
    if (message.audioMessage) return MessageContentType.AUDIO;
    if (message.videoMessage) return MessageContentType.VIDEO;
    if (message.documentMessage) return MessageContentType.DOCUMENT;
    if (message.stickerMessage) return MessageContentType.STICKER;
    if (message.locationMessage) return MessageContentType.LOCATION;
    if (message.reactionMessage) return MessageContentType.REACTION;
    if (message.buttonsResponseMessage || message.listResponseMessage)
      return MessageContentType.INTERACTIVE;
    return MessageContentType.TEXT;
  }

  private extractContent(message: any): NormalizedInboundMessage['content'] {
    if (!message || typeof message !== 'object') return { text: '' };

    if (message.conversation) return { text: message.conversation };
    if (message.extendedTextMessage)
      return { text: message.extendedTextMessage.text || '' };

    if (message.imageMessage) {
      const m = message.imageMessage;
      return {
        mediaUrl: m.url,
        mimeType: m.mimetype,
        fileSize: Number(m.fileLength) || undefined,
        caption: m.caption,
      };
    }
    if (message.audioMessage) {
      const m = message.audioMessage;
      return {
        mediaUrl: m.url,
        mimeType: m.mimetype,
        fileSize: Number(m.fileLength) || undefined,
      };
    }
    if (message.videoMessage) {
      const m = message.videoMessage;
      return {
        mediaUrl: m.url,
        mimeType: m.mimetype,
        fileSize: Number(m.fileLength) || undefined,
        caption: m.caption,
      };
    }
    if (message.documentMessage) {
      const m = message.documentMessage;
      return {
        mediaUrl: m.url,
        mimeType: m.mimetype,
        fileName: m.fileName,
        fileSize: Number(m.fileLength) || undefined,
        caption: m.caption,
      };
    }
    if (message.stickerMessage) {
      const m = message.stickerMessage;
      return { mediaUrl: m.url, mimeType: m.mimetype };
    }
    if (message.locationMessage) {
      const m = message.locationMessage;
      return {
        latitude: m.degreesLatitude,
        longitude: m.degreesLongitude,
        text: m.name || m.address,
      };
    }
    if (message.reactionMessage) {
      const m = message.reactionMessage;
      return {
        reaction: {
          emoji: m.text || '',
          targetMessageId: m.key?.id || '',
        },
      };
    }
    return { text: '[Tipo de mensagem não suportado]' };
  }
}
