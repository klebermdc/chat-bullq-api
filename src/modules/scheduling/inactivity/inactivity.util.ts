export function ballIsWithClient(
  lastOutboundAt: Date | null,
  lastInboundAt: Date | null,
): boolean {
  if (!lastOutboundAt) return false;
  if (!lastInboundAt) return true;
  return lastOutboundAt.getTime() > lastInboundAt.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Índice da faixa (0-based) em `bandsDays` para os dias parados desde a última
 * outbound. Retorna null se a bola não está com o cliente OU se ainda não
 * atingiu a 1ª faixa (< bandsDays[0]).
 */
export function computeBand(params: {
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
  bandsDays: number[];
  now: Date;
}): number | null {
  const { lastOutboundAt, lastInboundAt, bandsDays, now } = params;
  if (!ballIsWithClient(lastOutboundAt, lastInboundAt)) return null;
  const days = (now.getTime() - (lastOutboundAt as Date).getTime()) / DAY_MS;
  let band: number | null = null;
  for (let i = 0; i < bandsDays.length; i++) {
    if (days >= bandsDays[i]) band = i;
  }
  return band;
}

export function isEligibleForReengage(
  band: number | null,
  reengageFromBand: number,
): boolean {
  return band !== null && band >= reengageFromBand;
}
