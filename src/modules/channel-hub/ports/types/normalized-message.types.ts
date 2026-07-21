import { ChannelType } from '@prisma/client';

export enum MessageContentType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO',
  DOCUMENT = 'DOCUMENT',
  STICKER = 'STICKER',
  LOCATION = 'LOCATION',
  REACTION = 'REACTION',
  TEMPLATE = 'TEMPLATE',
  INTERACTIVE = 'INTERACTIVE',
  SYSTEM = 'SYSTEM',
}

export interface TemplateButton {
  type: string;
  title: string;
  url?: string;
  payload?: string;
}

export interface TemplateElement {
  title?: string;
  subtitle?: string;
  imageUrl?: string;
  defaultActionUrl?: string;
  buttons?: TemplateButton[];
}

export interface NormalizedMessageContent {
  text?: string;
  mediaUrl?: string;
  mediaId?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  caption?: string;
  latitude?: number;
  longitude?: number;
  reaction?: { emoji: string; targetMessageId: string };
  interactive?: { type: string; buttonId?: string; listRowId?: string };
  template?: {
    templateType?: string;
    text?: string;
    buttons?: TemplateButton[];
    elements?: TemplateElement[];
  };
}

/**
 * Rich reply context. On Instagram, users can reply to:
 *  - a message (`externalMessageId` is the parent mid)
 *  - a story       (`story.id` + `story.url` point to the original story)
 *  - a mention     (same shape as story, with `kind: 'mention'`)
 *  - an ad         (`ad.id` + `ad.title`)
 */
export interface ReplyContext {
  externalMessageId?: string;
  story?: { id?: string; url?: string; kind?: 'reply' | 'mention' };
  ad?: { id?: string; title?: string };
}

export interface NormalizedInboundMessage {
  externalMessageId: string;
  externalContactId: string;
  contactName?: string;
  contactPhone?: string;
  contactAvatarUrl?: string;
  channelType: ChannelType;
  timestamp: Date;
  type: MessageContentType;
  content: NormalizedMessageContent;
  replyTo?: ReplyContext;
  isForwarded?: boolean;
  isGroup?: boolean;
  isEcho?: boolean;
  senderName?: string;
  rawPayload: unknown;
}

export interface NormalizedOutboundMessage {
  type: MessageContentType;
  content: NormalizedMessageContent;
  /**
   * Quando preenchido, sinaliza ao adapter que a msg deve ser enviada
   * como reply à mensagem `externalMessageId`.
   *
   * - Zappfy/Uazapi: vira `replyid` no payload
   * - WhatsApp Official: vira `context.message_id`
   * - Instagram: a Messenger Platform NÃO suporta reply nativo em DMs.
   *   O adapter usa o `previewText`+`senderName` pra prefixar a msg
   *   com um quote textual ("> trecho\n\ntexto") como degradação.
   */
  replyTo?: {
    externalMessageId: string;
    /** Texto curto da msg citada — usado pelo Instagram como fallback. */
    previewText?: string;
    /** Nome de quem enviou a msg citada — Instagram fallback. */
    senderName?: string;
  };
}

export interface StatusUpdate {
  externalMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: Date;
  errorMessage?: string;
  /**
   * Janela de conversa de 24h da Meta (só WHATSAPP_OFFICIAL); presente no
   * status que abre a janela, ausente em delivered/read repetidos.
   */
  conversation?: {
    id: string;
    /** conversation.origin.type: marketing|utility|authentication|service */
    originType?: string;
    /**
     * conversation.expiration_timestamp — mantido como epoch SEGUNDOS cru
     * (diferente do irmão `timestamp: Date`) pra casar direto com o campo da Meta.
     */
    expirationTimestamp?: number;
  };
  /**
   * Dados de cobrança da Meta (só canal WHATSAPP_OFFICIAL). Presentes no
   * status `sent` que abre uma janela; ausentes em delivered/read repetidos.
   */
  pricing?: {
    billable?: boolean;
    /** pricing.category */
    category?: string;
    /** pricing.pricing_model: CBP|PMP */
    pricingModel?: string;
  };
}

export interface WebhookParseResult {
  messages: NormalizedInboundMessage[];
  statuses: StatusUpdate[];
  errors: WebhookError[];
  templateStatusUpdates?: Array<{
    metaTemplateId: string;
    status: string;
    reason?: string;
  }>;
}

export interface WebhookError {
  code: string;
  message: string;
  rawData?: unknown;
}

export interface VerificationResponse {
  statusCode: number;
  body: string | Record<string, unknown>;
}
