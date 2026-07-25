import { computeWhatsappWindow } from './whatsapp-window.util';

/** Forma mínima que o helper lê da conversa carregada. */
export interface WindowSource {
  lastInboundAt: Date | null;
  channel?: { type: string } | null;
  contact?: { ctwaClidAt: Date | null } | null;
}

/**
 * Anexa `windowExpiresAt` (ISO string | null) e `windowKind` à conversa,
 * computados no servidor (fonte única). Não muta o objeto original.
 */
export function attachWindowExpiry<T extends WindowSource>(
  conversation: T,
  now: Date = new Date(),
): T & { windowExpiresAt: string | null; windowKind: 'csw24' | 'ctwa72' | null } {
  const w = computeWhatsappWindow({
    channelType: conversation.channel?.type ?? '',
    lastInboundAt: conversation.lastInboundAt ?? null,
    ctwaClidAt: conversation.contact?.ctwaClidAt ?? null,
    now,
  });
  return {
    ...conversation,
    windowExpiresAt: w.expiresAt ? w.expiresAt.toISOString() : null,
    windowKind: w.kind,
  };
}
