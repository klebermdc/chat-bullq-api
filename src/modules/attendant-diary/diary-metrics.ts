import { SLOW_REPLY_MINUTES } from './diary.constants';
import type { DiaryMessage, DiaryMetrics } from './diary.types';

const MINUTE_MS = 60_000;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value);
}

function groupByConversation(messages: DiaryMessage[]): DiaryMessage[][] {
  const groups = new Map<string, DiaryMessage[]>();
  for (const message of messages) {
    groups.set(message.conversationId, [
      ...(groups.get(message.conversationId) ?? []),
      message,
    ]);
  }
  return [...groups.values()];
}

/** Tempos de resposta do atendente e se o cliente ficou sem retorno no fim. */
function readConversation(
  messages: DiaryMessage[],
  userId: string,
  isWorkingTime: (at: Date) => boolean,
): { replyMinutes: number[]; isUnanswered: boolean } {
  const replyMinutes: number[] = [];
  let waitingSince: Date | null = null;

  for (const message of messages) {
    if (message.direction === 'INBOUND') {
      waitingSince = waitingSince ?? message.at;
      continue;
    }
    // Robô não encerra a espera: o cliente continua sem resposta de gente.
    if (!message.senderId || !waitingSince) continue;
    if (message.senderId === userId && isWorkingTime(waitingSince)) {
      replyMinutes.push((message.at.getTime() - waitingSince.getTime()) / MINUTE_MS);
    }
    waitingSince = null;
  }

  return {
    replyMinutes,
    isUnanswered: waitingSince !== null && isWorkingTime(waitingSince),
  };
}

/**
 * Métricas do dia a partir das mensagens em ordem cronológica. Diferente do
 * painel, medem o trabalho do dia (inclusive conversas antigas) e ignoram a
 * espera de mensagens recebidas fora do horário do atendente.
 */
export function computeDiaryMetrics(
  messages: DiaryMessage[],
  userId: string,
  isWorkingTime: (at: Date) => boolean,
): DiaryMetrics {
  const sent = messages.filter((m) => m.senderId === userId);
  const readings = groupByConversation(messages).map((group) =>
    readConversation(group, userId, isWorkingTime),
  );
  const replyMinutes = readings.flatMap((r) => r.replyMinutes);

  return {
    conversations: new Set(sent.map((m) => m.conversationId)).size,
    messagesSent: sent.length,
    medianReplyMinutes: median(replyMinutes),
    slowReplies: replyMinutes.filter((m) => m > SLOW_REPLY_MINUTES).length,
    unansweredAtEndOfDay: readings.filter((r) => r.isUnanswered).length,
  };
}
