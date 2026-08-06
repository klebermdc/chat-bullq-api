const HOUR_MS = 60 * 60 * 1000;
export const CSW_WINDOW_MS = 24 * HOUR_MS;
export const CTWA_WINDOW_MS = 72 * HOUR_MS;

export interface WhatsappWindowInput {
  channelType: string;
  lastInboundAt: Date | null;
  ctwaClidAt: Date | null;
  /**
   * `conversation.expiration_timestamp` que a PRÓPRIA Meta manda no webhook de
   * status. É a fonte autoritativa: sob pricing PMP ela parou de anexar
   * `referral` na mensagem de entrada e só informa o free entry point aqui, de
   * modo que `ctwaClidAt` fica null em parte dos leads de anúncio. Opcional
   * porque só existe depois do 1º envio nosso na conversa.
   */
  metaWindowExpiresAt?: Date | null;
  now: Date;
}

export interface WhatsappWindowState {
  /** true só para WHATSAPP_OFFICIAL — os demais canais não têm a regra da Meta. */
  applicable: boolean;
  /** Pode enviar texto livre agora? (não-aplicável ⇒ sempre true) */
  open: boolean;
  /** Quando a janela de texto livre fecha. null quando não aplicável ou nunca abriu. */
  expiresAt: Date | null;
  /** Qual regra deu a janela vigente. */
  kind: 'csw24' | 'ctwa72' | null;
}

/**
 * Janela efetiva de texto livre = max(lastInboundAt+24h, ctwaClidAt+72h,
 * metaWindowExpiresAt). Só vale para o canal oficial (Meta). Sem timestamps
 * ⇒ fechada (a 1ª msg de uma conversa oficial exige template).
 */
export function computeWhatsappWindow(
  input: WhatsappWindowInput,
): WhatsappWindowState {
  if (input.channelType !== 'WHATSAPP_OFFICIAL') {
    return { applicable: false, open: true, expiresAt: null, kind: null };
  }
  const csw = input.lastInboundAt
    ? input.lastInboundAt.getTime() + CSW_WINDOW_MS
    : null;
  const ctwa = input.ctwaClidAt
    ? input.ctwaClidAt.getTime() + CTWA_WINDOW_MS
    : null;

  let expMs: number | null = null;
  let kind: 'csw24' | 'ctwa72' | null = null;
  if (csw !== null) {
    expMs = csw;
    kind = 'csw24';
  }
  if (ctwa !== null && (expMs === null || ctwa > expMs)) {
    expMs = ctwa;
    kind = 'ctwa72';
  }
  // A Meta só emite `conversation.expiration_timestamp` para free entry point
  // (conversa de anúncio, `billable:false`), então quando ele estende a janela
  // é sempre a regra de 72h que está valendo. Só ESTENDE — um valor menor não
  // pode encurtar a CSW de 24h, que a Meta honra de qualquer forma.
  const meta = input.metaWindowExpiresAt
    ? input.metaWindowExpiresAt.getTime()
    : null;
  if (meta !== null && (expMs === null || meta > expMs)) {
    expMs = meta;
    kind = 'ctwa72';
  }
  if (expMs === null) {
    return { applicable: true, open: false, expiresAt: null, kind: null };
  }
  return {
    applicable: true,
    open: input.now.getTime() < expMs,
    expiresAt: new Date(expMs),
    kind,
  };
}
