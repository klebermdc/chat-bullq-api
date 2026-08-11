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
  interactive?: {
    type: string;
    buttonId?: string;
    listRowId?: string;
    payload?: string;
  };
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
  /**
   * Echo COMPROVADAMENTE humano — alguém digitou no app do WhatsApp Business.
   *
   * Difere do `isEcho` comum: em canal Baileys, a mensagem que NÓS enviamos
   * também volta como echo, então `isEcho` sozinho não distingue "vendedor
   * digitou no celular" de "bot respondeu". Já o `smb_message_echoes` da
   * coexistência traz só o que saiu do app/dispositivo vinculado — nunca os
   * nossos envios pela Cloud API.
   *
   * Só com esta certeza dá pra aplicar os efeitos de "humano respondeu"
   * (desarmar a IA, sair de "Esperando") sem risco de o bot se auto-silenciar.
   */
  isHumanEcho?: boolean;
  senderName?: string;
  // Atribuição Click-to-WhatsApp: presente só na 1ª mensagem após o clique no
  // anúncio (Cloud API entrega em message.referral). Persistido no Contact
  // para o evento Purchase da Meta CAPI quando o lead fecha em GANHO.
  referral?: InboundReferral;
  rawPayload: unknown;
}

export interface InboundReferral {
  ctwaClid?: string;
  sourceId?: string; // ad id / source_id do referral
  sourceType?: string; // "ad" | "post"
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
  /**
   * Reclassificação de categoria de template (webhook `template_category_update`).
   * `category` é sempre a categoria que VAI valer, e `pending` diz se ela já
   * está valendo. A Meta manda dois eventos com o mesmo campo: o aviso prévio
   * (~24h antes, onde `new_category` ainda é a categoria ATUAL e a futura vem
   * em `correct_category`) e a mudança consumada.
   */
  templateCategoryUpdates?: Array<{
    metaTemplateId: string;
    category: string;
    pending: boolean;
    effectiveAt?: Date;
  }>;
  /** Eventos de conta (WABA): desconexão, banimento, tier, qualidade. */
  accountUpdates?: AccountUpdate[];
  /** Pedaços de histórico da coexistência (webhook `history`). */
  historyChunks?: HistoryChunk[];
  /** Mudanças de agenda vindas do app (webhook `smb_app_state_sync`). */
  contactSyncs?: ContactSync[];
}

/**
 * Evento de nível de CONTA (WABA), não de mensagem. Chega no campo
 * `account_update`. É como se descobre que um cliente nos desconectou, foi
 * banido, mudou de tier ou teve a qualidade do número rebaixada.
 *
 * Obrigatório na coexistência, mas vale pra qualquer canal oficial: sem isso
 * um cliente pode sumir e a gente só percebe pelo silêncio dele.
 */
export interface AccountUpdate {
  /** `event` cru da Meta: PARTNER_REMOVED, ACCOUNT_VIOLATION, ... */
  event: string;
  /** WABA a que o evento se refere. */
  businessAccountId?: string;
  /** Número afetado, quando o evento é de número e não de conta. */
  phoneNumber?: string;
  /** Payload cru pra auditoria — a Meta muda esse contrato sem avisar. */
  raw?: unknown;
}

/**
 * Pedaço do histórico empurrado pela Meta após um onboarding de coexistência.
 * É PUSH (webhook), diferente do sync do Zappfy que é PULL.
 *
 * ⚠️ Há prazo: 24h a partir do onboarding pra concluir a sincronização,
 * senão o cliente precisa ser desconectado e refazer o fluxo.
 */
export interface HistoryChunk {
  /** Fase da sincronização, definida pela Meta. */
  phase?: string;
  /** Ordem do pedaço dentro da fase — a entrega não é garantidamente ordenada. */
  chunkOrder?: number;
  /** Progresso reportado pela Meta (0-100). */
  progress?: number;
  threads: HistoryThread[];
  /** Erro no lugar do histórico — ex.: 2593109 = cliente desligou o sync no app. */
  error?: { code?: number; message?: string };
}

export interface HistoryThread {
  /** Telefone do cliente — identifica a conversa e o contato. */
  contactPhone: string;
  messages: HistoryMessage[];
}

export interface HistoryMessage {
  externalId: string;
  /** true = quem enviou foi o NEGÓCIO (vira OUTBOUND). */
  fromBusiness: boolean;
  timestamp?: Date;
  type: MessageContentType;
  content: NormalizedMessageContent;
}

/**
 * Mudança na agenda do cliente, espelhada do app do WhatsApp Business
 * (webhook `smb_app_state_sync`). Só existe em canal de coexistência.
 */
export interface ContactSync {
  phone: string;
  fullName?: string;
  firstName?: string;
  /** `add` | `update` | `remove` (a Meta varia o rótulo). */
  action: string;
  timestamp?: Date;
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
