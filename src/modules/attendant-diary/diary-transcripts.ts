import {
  MAX_CONVERSATIONS_PER_DIARY,
  MAX_LINE_CHARS,
  MAX_LINES_PER_CONVERSATION,
} from './diary.constants';
import type { DiaryMessage, DiaryTranscript, DiaryTranscriptLine } from './diary.types';

const EMPTY_TEXT = '[mídia sem texto]';

function toLine(message: DiaryMessage, userId: string, isContext: boolean): DiaryTranscriptLine {
  const role =
    message.direction === 'INBOUND'
      ? 'CLIENTE'
      : message.senderId === userId
        ? 'ATENDENTE'
        : 'EQUIPE';
  // Em uma linha só: quebra de linha do cliente não pode forjar outra fala.
  const text = message.text.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_CHARS) || EMPTY_TEXT;
  return { role, text, isContext };
}

/** Conversas do dia em que o atendente mais falou, com o contexto anterior. */
export function selectConversationIds(messages: DiaryMessage[], userId: string): string[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (message.senderId !== userId) continue;
    counts.set(message.conversationId, (counts.get(message.conversationId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CONVERSATIONS_PER_DIARY)
    .map(([conversationId]) => conversationId);
}

export function buildTranscripts(
  dayMessages: DiaryMessage[],
  contextMessages: DiaryMessage[],
  userId: string,
): DiaryTranscript[] {
  return selectConversationIds(dayMessages, userId).map((conversationId, index) => {
    const ofConversation = (m: DiaryMessage) => m.conversationId === conversationId;
    const context = contextMessages
      .filter(ofConversation)
      .map((m) => toLine(m, userId, true));
    const day = dayMessages
      .filter(ofConversation)
      .slice(-MAX_LINES_PER_CONVERSATION)
      .map((m) => toLine(m, userId, false));
    return { ref: `C${index + 1}`, conversationId, lines: [...context, ...day] };
  });
}
