/**
 * Os únicos momentos que viram push no aparelho do vendedor. Qualquer outro
 * aviso (lead sem dono, menção, SLA, sistema) fica só no sino do app.
 */
export type PushKind = 'message' | 'handoff' | 'seller_note' | 'support_ticket';

/** O que o produtor do aviso pede: quem é o cliente e de qual conversa. */
export interface PushIntent {
  kind: PushKind;
  contactName: string;
  conversationId: string;
}

/** O que viaja até o service worker. Nunca leva o texto do cliente. */
export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  href: string;
}
