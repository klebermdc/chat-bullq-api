import { MAX_LINE_CHARS, MAX_TRANSCRIPT_LINES } from './mystery-shopper.constants';
import type { VisitLine, VisitMessage, VisitRole } from './mystery-shopper.types';
import { isHumanReply } from './visit-metrics';

const EMPTY_TEXT = '[mídia sem texto]';

const roleOf = (m: VisitMessage): VisitRole =>
  m.direction === 'INBOUND' ? 'CLIENTE' : isHumanReply(m) ? 'VENDEDOR' : 'AUTOMATICA';

/** Em uma linha só: quebra de linha do cliente não pode forjar outra fala no prompt. */
export function buildVisitLines(messages: VisitMessage[]): VisitLine[] {
  return messages.slice(-MAX_TRANSCRIPT_LINES).map((m) => ({
    messageId: m.id,
    role: roleOf(m),
    text: m.text.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_CHARS) || EMPTY_TEXT,
    createdAt: m.createdAt,
  }));
}
