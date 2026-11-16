const HOUR_MS = 60 * 60 * 1000;
export const CSW_WINDOW_MS = 24 * HOUR_MS;

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
 * Janela de texto livre = lastInboundAt + 24h (CSW). Só vale nos canais da
 * Meta (WhatsApp oficial e Messenger). Sem inbound ⇒ fechada (a 1ª msg de uma
 * conversa oficial exige template).
 *
 * Até 16/11/2026 o clique em anúncio (`ctwaClidAt`, 72h) e a expiração que a
 * Meta manda no status (`metaWindowExpiresAt`, 7 dias desde 28/09) ESTENDIAM a
 * janela. No número 5198-4190 (WABA nova, desde 07/11) nenhum texto livre
 * enviado depois de 24h chegou ao cliente (131070 ou preso em SENT), e a
 * ampulheta mostrando "96h" levava o vendedor a escrever e falhar. Os dois
 * campos continuam no input para não mexer nos chamadores, mas não contam mais.
 */
export function computeWhatsappWindow(
  input: WhatsappWindowInput,
): WhatsappWindowState {
  if (input.channelType !== 'WHATSAPP_OFFICIAL' && input.channelType !== 'MESSENGER') {
    return { applicable: false, open: true, expiresAt: null, kind: null };
  }
  if (!input.lastInboundAt) {
    return { applicable: true, open: false, expiresAt: null, kind: null };
  }
  const expMs = input.lastInboundAt.getTime() + CSW_WINDOW_MS;
  return {
    applicable: true,
    open: input.now.getTime() < expMs,
    expiresAt: new Date(expMs),
    kind: 'csw24',
  };
}
