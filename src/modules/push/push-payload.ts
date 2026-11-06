/*
 * Adaptado de DeskcommCRM (https://github.com/melgarafael/DeskcommCRM), MIT License, Copyright (c) 2026 Rafael Melgaço.
 * Origem: lib/notifications/push_payload.ts e lib/notifications/tela-bloqueada.ts
 */
import { PushIntent, PushKind, PushPayload } from './push.types';

export const PUSH_TITLE_MAX = 60;
const FALLBACK_TITLE = 'Cliente';

/**
 * Corpo fixo por tipo. A tela bloqueada mostra só QUEM (título) e O QUE
 * aconteceu (frase fixa): o texto do cliente nunca entra no payload.
 */
export const PUSH_BODY_BY_KIND: Readonly<Record<PushKind, string>> = {
  message: 'mandou mensagem',
  handoff: 'foi passado para você',
  seller_note: 'tem recado do plantão para você',
  support_ticket: 'abriu chamado de suporte',
};

/**
 * Uma tag por conversa: 10 mensagens (ou mensagem + transferência) da mesma
 * conversa substituem o mesmo aviso em vez de empilhar 10.
 */
export function conversationTag(conversationId: string): string {
  return `conv:${conversationId}`;
}

export function conversationHref(conversationId: string): string {
  return `/inbox?conversationId=${encodeURIComponent(conversationId)}`;
}

function cleanTitle(name: string): string {
  const t = name.trim().replace(/\s+/g, ' ');
  if (!t) return FALLBACK_TITLE;
  return t.length <= PUSH_TITLE_MAX ? t : `${t.slice(0, PUSH_TITLE_MAX - 1)}…`;
}

/** Montado campo a campo, nunca por spread: nenhum campo extra vaza. */
export function buildPushPayload(intent: PushIntent): PushPayload {
  return {
    title: cleanTitle(intent.contactName),
    body: PUSH_BODY_BY_KIND[intent.kind],
    tag: conversationTag(intent.conversationId),
    href: conversationHref(intent.conversationId),
  };
}
