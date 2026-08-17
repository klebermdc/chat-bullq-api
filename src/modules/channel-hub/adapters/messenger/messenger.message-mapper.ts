import { Injectable } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import {
  NormalizedInboundMessage,
  NormalizedOutboundMessage,
  MessageContentType,
  StatusUpdate,
  TemplateButton,
  TemplateElement,
} from '../../ports/types';

/**
 * Tipos de anexo da Messenger Platform → nosso tipo de conteudo.
 * `sticker` vem antes de `image` de proposito: ate 30/08/2026 a Meta envia os
 * dois no mesmo payload, e queremos classificar como figurinha.
 *
 * `share` e `template` espelham o `instagram.message-mapper.ts` (referencia
 * de producao) — a Messenger Platform e a Instagram Messaging API sao a
 * mesma familia de payload.
 */
const ATTACHMENT_TYPE_MAP: Record<string, MessageContentType> = {
  sticker: MessageContentType.STICKER,
  image: MessageContentType.IMAGE,
  audio: MessageContentType.AUDIO,
  video: MessageContentType.VIDEO,
  reel: MessageContentType.VIDEO,
  ig_reel: MessageContentType.VIDEO,
  file: MessageContentType.DOCUMENT,
  fallback: MessageContentType.TEXT,
  share: MessageContentType.TEXT,
  template: MessageContentType.TEMPLATE,
};

@Injectable()
export class MessengerMessageMapper {
  normalizeInbound(messaging: Record<string, any>): NormalizedInboundMessage | null {
    const senderId = messaging.sender?.id;
    const recipientId = messaging.recipient?.id;
    const message = messaging.message;
    if (!senderId || !message) return null;

    const isEcho = !!message.is_echo;
    // Em echo (mensagem que a Pagina enviou pelo app da Meta), o "contato" e o
    // destinatario — o remetente somos nos.
    const externalContactId = isEcho ? recipientId : senderId;
    if (!externalContactId) return null;

    const result: NormalizedInboundMessage = {
      externalMessageId: message.mid,
      externalContactId,
      channelType: ChannelType.MESSENGER,
      timestamp: new Date(messaging.timestamp),
      type: this.resolveContentType(message),
      content: this.extractContent(message),
      isEcho,
      rawPayload: messaging,
    };

    if (message.reply_to?.mid) {
      result.replyTo = { externalMessageId: String(message.reply_to.mid) };
    }

    return result;
  }

  normalizeStatus(messaging: Record<string, any>): StatusUpdate | null {
    const delivery = messaging.delivery;
    if (!delivery?.mids?.length) return null;

    return {
      externalMessageId: delivery.mids[0],
      status: 'delivered',
      timestamp: new Date(messaging.timestamp),
    };
  }

  /**
   * A Meta manda `read` com um `watermark` (sem mids): tudo que foi enviado ate
   * aquele instante foi lido. O processor faz a atualizacao em massa.
   */
  normalizeReadStatus(messaging: Record<string, any>): StatusUpdate | null {
    const read = messaging.read;
    if (!read?.watermark) return null;

    return {
      externalMessageId: `messenger-read-watermark:${read.watermark}`,
      status: 'read',
      timestamp: new Date(Number(read.watermark) || messaging.timestamp),
    };
  }

  denormalize(
    message: NormalizedOutboundMessage,
    contactExternalId: string,
  ): Record<string, any> {
    const base = { recipient: { id: contactExternalId } };

    // A Messenger Send API nao suporta reply nativo. Degradamos citando o
    // trecho no corpo da mensagem — mesmo tratamento do Instagram (media
    // ignora a citacao la tambem: sem suporte a envio composto, o quote em
    // midia fica pra depois).
    const quotePrefix = buildQuotePrefix(message.replyTo);
    const withQuote = (text: string): string => (quotePrefix ? `${quotePrefix}${text}` : text);

    const asAttachment = (type: string) => ({
      ...base,
      message: {
        attachment: { type, payload: { url: message.content.mediaUrl, is_reusable: true } },
      },
    });

    switch (message.type) {
      case MessageContentType.IMAGE:
      case MessageContentType.STICKER:
        return asAttachment('image');
      case MessageContentType.AUDIO:
        return asAttachment('audio');
      case MessageContentType.VIDEO:
        return asAttachment('video');
      case MessageContentType.DOCUMENT:
        return asAttachment('file');
      default:
        return { ...base, message: { text: withQuote(message.content.text || '') } };
    }
  }

  private resolveContentType(msg: Record<string, any>): MessageContentType {
    if (msg.quick_reply) return MessageContentType.INTERACTIVE;

    const attachment = this.pickAttachment(msg);
    if (attachment) {
      return ATTACHMENT_TYPE_MAP[attachment.type] ?? MessageContentType.TEXT;
    }

    return MessageContentType.TEXT;
  }

  /**
   * Escolhe o anexo relevante. Durante a transicao de figurinha da Meta o
   * payload traz `image` E `sticker` descrevendo a MESMA figurinha — o
   * `sticker` ganha, senao a figurinha entraria no inbox como foto comum.
   */
  private pickAttachment(msg: Record<string, any>): Record<string, any> | null {
    const attachments: any[] = msg.attachments ?? [];
    if (attachments.length === 0) return null;
    return attachments.find((a) => a?.type === 'sticker') ?? attachments[0];
  }

  private extractContent(msg: Record<string, any>): NormalizedInboundMessage['content'] {
    if (msg.quick_reply) {
      return {
        text: msg.text,
        interactive: { type: 'quick_reply', payload: msg.quick_reply.payload },
      };
    }

    const attachment = this.pickAttachment(msg);
    if (attachment) {
      const payload = attachment.payload ?? {};
      switch (attachment.type) {
        case 'sticker':
          return { mediaUrl: payload.url, mimeType: 'image/png' };
        case 'image':
          return { mediaUrl: payload.url, mimeType: 'image/jpeg' };
        case 'audio':
          return { mediaUrl: payload.url, mimeType: 'audio/mp4' };
        case 'video':
        case 'reel':
        case 'ig_reel':
          return { mediaUrl: payload.url, mimeType: 'video/mp4' };
        case 'file':
          return { mediaUrl: payload.url, fileName: payload.name };
        case 'fallback':
          return { text: payload.title || payload.url || '[Conteudo compartilhado]' };
        case 'share':
          return { text: payload.url || '[Conteudo compartilhado]' };
        case 'template':
          return this.extractTemplateContent(payload);
        default:
          return { text: msg.text || `[${attachment.type}]` };
      }
    }

    if (msg.text) return { text: msg.text };

    return { text: '[Mensagem nao suportada]' };
  }

  /**
   * Copiado de `instagram.message-mapper.ts` (referencia de producao) —
   * mesmo shape de payload de template na Messenger Platform e na Instagram
   * Messaging API. Necessario ja nesta task porque a Task 7 (envio) vai ecoar
   * de volta as mensagens com botao/carrossel que a propria Pagina enviou;
   * sem isso o eco cairia no `default` e perderia os botoes.
   */
  private extractTemplateContent(payload: Record<string, any>): NormalizedInboundMessage['content'] {
    // A Meta aninha os dados sob uma chave com o nome do tipo de template
    // (ex.: payload.generic.elements, payload.button.buttons). Formatos mais
    // antigos tambem expoem template_type + campos irmaos direto no payload.
    const wrapperKey = Object.keys(payload).find(
      (k) => payload[k] && typeof payload[k] === 'object' && !Array.isArray(payload[k]),
    );
    const inner =
      wrapperKey && (payload[wrapperKey] as Record<string, any>) ? payload[wrapperKey] : payload;
    const templateType =
      (payload.template_type as string | undefined) || wrapperKey || undefined;

    const mapBtn = (b: any): TemplateButton => ({
      type: String(b?.type ?? 'web_url'),
      title: String(b?.title ?? ''),
      url: b?.url ? String(b.url) : undefined,
      payload: b?.payload ? String(b.payload) : undefined,
    });

    const rawButtons = Array.isArray(inner.buttons)
      ? inner.buttons
      : Array.isArray(payload.buttons)
        ? payload.buttons
        : [];
    const buttons: TemplateButton[] = rawButtons.map(mapBtn);

    const rawElements = Array.isArray(inner.elements)
      ? inner.elements
      : Array.isArray(payload.elements)
        ? payload.elements
        : [];
    const elements: TemplateElement[] = rawElements.map((el: any) => ({
      title: el?.title ? String(el.title) : undefined,
      subtitle: el?.subtitle ? String(el.subtitle) : undefined,
      imageUrl: el?.image_url ? String(el.image_url) : undefined,
      defaultActionUrl: el?.default_action?.url ? String(el.default_action.url) : undefined,
      buttons: Array.isArray(el?.buttons) ? el.buttons.map(mapBtn) : undefined,
    }));

    const headerText =
      (inner.text ? String(inner.text) : undefined) ||
      (payload.text ? String(payload.text) : undefined);
    const elementText = elements
      .map((el) => [el.title, el.subtitle].filter(Boolean).join(' — '))
      .filter(Boolean)
      .join('\n');
    const text = headerText || elementText || undefined;

    return {
      text,
      template: {
        templateType,
        text: headerText,
        buttons: buttons.length ? buttons : undefined,
        elements: elements.length ? elements : undefined,
      },
    };
  }
}

/**
 * O Send API do Messenger nao suporta reply nativo. Degradamos citando o
 * trecho no corpo da mensagem — mesmo tratamento usado no Instagram
 * (`buildIgQuotePrefix` em `instagram.message-mapper.ts`).
 *
 * Sem nome nem preview uteis, nao cita nada: melhor sem citacao do que
 * mostrar "> undefined" pro cliente.
 */
function buildQuotePrefix(replyTo: NormalizedOutboundMessage['replyTo']): string {
  if (!replyTo) return '';

  const sender = replyTo.senderName?.trim();
  let preview = replyTo.previewText?.trim() ?? '';
  if (!sender && !preview) return '';
  if (preview.length > 120) preview = preview.slice(0, 117) + '…';

  const senderLine = sender ? `> ${sender} disse:\n` : '';
  const previewLine = preview ? `> ${preview}\n\n` : '\n';
  return `${senderLine}${previewLine}`;
}
