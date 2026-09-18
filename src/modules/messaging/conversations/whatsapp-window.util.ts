const HOUR_MS = 60 * 60 * 1000;
export const CSW_WINDOW_MS = 24 * HOUR_MS;
export const CTWA_WINDOW_MS = 72 * HOUR_MS;

export interface WhatsappWindowInput {
  channelType: string;
  lastInboundAt: Date | null;
  ctwaClidAt: Date | null;
  /**
   * `conversation.expiration_timestamp` que a PRÓPRIA Meta manda no webhook de
   * status para o free entry point (lead de anúncio). Sob pricing PMP ela parou
   * de anexar `referral` na mensagem de entrada, então `ctwaClidAt` fica null
   * em parte dos leads de anúncio e esta é a única fonte. Opcional porque só
   * existe depois do 1º envio nosso na conversa.
   */
  metaWindowExpiresAt?: Date | null;
  now: Date;
}

export interface WhatsappWindowState {
  /** true para WHATSAPP_OFFICIAL e MESSENGER — os demais canais não têm a regra da Meta. */
  applicable: boolean;
  /** Pode enviar texto livre agora? (não-aplicável ⇒ sempre true) */
  open: boolean;
  /** Quando a janela de texto livre (CSW 24h) fecha. null quando não aplicável ou nunca abriu. */
  expiresAt: Date | null;
  /** Regra da janela de texto livre — hoje só existe a CSW de 24h. */
  kind: 'csw24' | null;
  /**
   * Fim do free entry point de 72h (lead Click-to-WhatsApp): até aqui as
   * mensagens saem GRATUITAS, mas fora da CSW só vai template. É uma contagem
   * de custo, NÃO libera texto livre. null quando não há anúncio conhecido.
   */
  freeEntryExpiresAt: Date | null;
}

/** Maior timestamp não-nulo, ou null quando nenhum existe. */
function latest(...dates: Array<number | null>): number | null {
  const known = dates.filter((d): d is number => d !== null);
  return known.length > 0 ? Math.max(...known) : null;
}

/**
 * Duas contagens independentes, só para canais da Meta:
 *
 * - Texto livre = lastInboundAt + 24h (customer service window). É a ÚNICA
 *   regra que a Meta aplica a mensagens não-template: fora dela o envio volta
 *   `[131047] Re-engagement message` — inclusive dentro das 72h de anúncio
 *   (caso real de 2026-09-18, 47 envios derrubados em 30 dias).
 * - Template grátis (free entry point) = max(ctwaClidAt + 72h,
 *   metaWindowExpiresAt). Só WhatsApp; no Messenger não existe.
 */
export function computeWhatsappWindow(
  input: WhatsappWindowInput,
): WhatsappWindowState {
  if (input.channelType !== 'WHATSAPP_OFFICIAL' && input.channelType !== 'MESSENGER') {
    return {
      applicable: false,
      open: true,
      expiresAt: null,
      kind: null,
      freeEntryExpiresAt: null,
    };
  }

  const isWhatsapp = input.channelType === 'WHATSAPP_OFFICIAL';
  const freeEntryMs = isWhatsapp
    ? latest(
        input.ctwaClidAt ? input.ctwaClidAt.getTime() + CTWA_WINDOW_MS : null,
        input.metaWindowExpiresAt ? input.metaWindowExpiresAt.getTime() : null,
      )
    : null;
  const freeEntryExpiresAt = freeEntryMs === null ? null : new Date(freeEntryMs);

  if (!input.lastInboundAt) {
    return { applicable: true, open: false, expiresAt: null, kind: null, freeEntryExpiresAt };
  }

  const cswMs = input.lastInboundAt.getTime() + CSW_WINDOW_MS;
  return {
    applicable: true,
    open: input.now.getTime() < cswMs,
    expiresAt: new Date(cswMs),
    kind: 'csw24',
    freeEntryExpiresAt,
  };
}
