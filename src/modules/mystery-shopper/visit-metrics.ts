import { FIRST_REPLY_GOOD_MINUTES, FIRST_REPLY_OK_MINUTES } from './mystery-shopper.constants';
import type { Score, VisitMessage, VisitMetrics } from './mystery-shopper.types';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const oneDecimal = (n: number) => Math.round(n * 10) / 10;

/** Fala de gente da equipe: tem autor e não foi envio automático. Aline não tem autor. */
export const isHumanReply = (m: VisitMessage): boolean =>
  m.direction === 'OUTBOUND' && !!m.senderId && !m.isAutomated;

/** Fala do vendedor avaliado; sem vendedor conhecido, qualquer humano conta. */
const isSellerReply = (m: VisitMessage, sellerUserId: string | null): boolean =>
  isHumanReply(m) && (!sellerUserId || m.senderId === sellerUserId);

interface MetricsInput {
  messages: VisitMessage[];
  /** Primeira distribuição (log ASSIGNED); null = conta desde o cliente. */
  assignedAt: Date | null;
  proposalCount: number;
  /** Vendedor avaliado; null = qualquer humano conta como vendedor. */
  sellerUserId: string | null;
}

export function computeVisitMetrics(input: MetricsInput): VisitMetrics {
  const ordered = [...input.messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const human = ordered.filter(isHumanReply); // tempo de resposta: qualquer pessoa da empresa
  const seller = ordered.filter((m) => isSellerReply(m, input.sellerUserId));
  const firstInbound = ordered.find((m) => m.direction === 'INBOUND');
  const lastInbound = [...ordered].reverse().find((m) => m.direction === 'INBOUND');
  const start = input.assignedAt ?? firstInbound?.createdAt ?? null;
  const firstReply = start ? human.find((m) => m.createdAt >= start) : undefined;
  const followUps = lastInbound ? seller.filter((m) => m.createdAt > lastInbound.createdAt) : [];

  return {
    firstHumanReplyMinutes:
      start && firstReply ? oneDecimal((firstReply.createdAt.getTime() - start.getTime()) / MINUTE_MS) : null,
    humanMessages: seller.length,
    followUps: followUps.length,
    firstFollowUpHours:
      lastInbound && followUps[0]
        ? oneDecimal((followUps[0].createdAt.getTime() - lastInbound.createdAt.getTime()) / HOUR_MS)
        : null,
    proposalSent: input.proposalCount > 0,
    lastShopperMessageAt: lastInbound ? lastInbound.createdAt.toISOString() : null,
  };
}

export function scoreFirstReply(minutes: number | null): Score {
  if (minutes === null) return 0;
  if (minutes <= FIRST_REPLY_GOOD_MINUTES) return 2;
  if (minutes <= FIRST_REPLY_OK_MINUTES) return 1;
  return 0;
}
