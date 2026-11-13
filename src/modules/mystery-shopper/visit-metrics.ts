import {
  FIRST_REPLY_GOOD_MINUTES,
  FIRST_REPLY_OK_MINUTES,
  FOLLOW_UP_MIN_GAP_HOURS,
  FOLLOW_UP_WINDOW_HOURS,
} from './mystery-shopper.constants';
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

/**
 * Follow-up = mensagem do vendedor enviada de 2h a 72h depois do último INBOUND que a precede
 * (sem INBOUND no meio). A resposta do cliente ao follow-up não o apaga.
 */
function findFollowUps(ordered: VisitMessage[], sellerUserId: string | null): Array<{ gapHours: number }> {
  const found: Array<{ gapHours: number }> = [];
  let lastInboundAt: Date | null = null;
  for (const m of ordered) {
    if (m.direction === 'INBOUND') {
      lastInboundAt = m.createdAt;
      continue;
    }
    if (!lastInboundAt || !isSellerReply(m, sellerUserId)) continue;
    const gapHours = (m.createdAt.getTime() - lastInboundAt.getTime()) / HOUR_MS;
    if (gapHours >= FOLLOW_UP_MIN_GAP_HOURS && gapHours <= FOLLOW_UP_WINDOW_HOURS) found.push({ gapHours });
  }
  return found;
}

export function computeVisitMetrics(input: MetricsInput): VisitMetrics {
  const ordered = [...input.messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const human = ordered.filter(isHumanReply); // tempo de resposta: qualquer pessoa da empresa
  const seller = ordered.filter((m) => isSellerReply(m, input.sellerUserId));
  const firstInbound = ordered.find((m) => m.direction === 'INBOUND');
  const lastInbound = [...ordered].reverse().find((m) => m.direction === 'INBOUND');
  const start = input.assignedAt ?? firstInbound?.createdAt ?? null;
  const firstReply = start ? human.find((m) => m.createdAt >= start) : undefined;
  const followUps = findFollowUps(ordered, input.sellerUserId);

  return {
    firstHumanReplyMinutes:
      start && firstReply ? oneDecimal((firstReply.createdAt.getTime() - start.getTime()) / MINUTE_MS) : null,
    humanMessages: seller.length,
    followUps: followUps.length,
    firstFollowUpHours:
      followUps[0] ? oneDecimal(followUps[0].gapHours) : null,
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
