import { ChannelType, OrgRole } from '@prisma/client';

/**
 * Assinatura do vendedor: o cliente vê, na linha de cima da mensagem, quem
 * está falando com ele ("*Bárbara:*"). Só o texto que vai pro provedor leva a
 * assinatura — a Message no banco guarda o texto limpo, que é o que o inbox
 * mostra (a bolha já identifica o remetente).
 */

const WHATSAPP_CHANNELS: ReadonlySet<ChannelType> = new Set<ChannelType>([
  ChannelType.WHATSAPP_OFFICIAL,
  ChannelType.WHATSAPP_ZAPPFY,
  ChannelType.WHATSAPP_WASENDER,
]);

/** Quem pode desligar a assinatura num envio. */
const UNSIGNED_ROLES: ReadonlySet<OrgRole> = new Set<OrgRole>([
  OrgRole.OWNER,
  OrgRole.ADMIN,
]);

export function canSendUnsigned(role: OrgRole | undefined): boolean {
  return role !== undefined && UNSIGNED_ROLES.has(role);
}

/** WhatsApp formata `*negrito*`; Instagram/Messenger mostrariam os asteriscos. */
export function formatSignature(name: string, channelType: ChannelType): string {
  const clean = name.trim();
  return WHATSAPP_CHANNELS.has(channelType) ? `*${clean}:*` : `${clean}:`;
}

export function applySellerSignature(
  content: Record<string, any>,
  opts: { type: string; senderName: string | null | undefined; channelType: ChannelType },
): Record<string, any> {
  const text = content?.text;
  const name = opts.senderName?.trim();
  if (opts.type !== 'TEXT' || typeof text !== 'string' || !text.trim() || !name) {
    return content;
  }
  return { ...content, text: `${formatSignature(name, opts.channelType)}\n${text}` };
}
