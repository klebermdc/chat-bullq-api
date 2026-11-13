import { MAX_LINE_CHARS, MAX_TRANSCRIPT_LINES } from './mystery-shopper.constants';
import type { VisitLine, VisitMessage, VisitRole } from './mystery-shopper.types';
import { isHumanReply } from './visit-metrics';

const EMPTY_TEXT = '[mídia sem texto]';

function roleOf(m: VisitMessage, sellerUserId: string | null): VisitRole {
  if (m.direction === 'INBOUND') return 'CLIENTE';
  if (!isHumanReply(m)) return 'AUTOMATICA';
  return sellerUserId && m.senderId !== sellerUserId ? 'EQUIPE' : 'VENDEDOR';
}

/** Em uma linha só: quebra de linha do cliente não pode forjar outra fala no prompt. */
/** sellerUserId null = vendedor desconhecido: toda fala humana conta como VENDEDOR. */
export function buildVisitLines(messages: VisitMessage[], sellerUserId: string | null): VisitLine[] {
  const ordered = [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return ordered.slice(-MAX_TRANSCRIPT_LINES).map((m) => ({
    messageId: m.id,
    role: roleOf(m, sellerUserId),
    text: m.text.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_CHARS) || EMPTY_TEXT,
    createdAt: m.createdAt,
  }));
}
