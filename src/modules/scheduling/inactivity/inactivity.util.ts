export function ballIsWithClient(
  lastOutboundAt: Date | null,
  lastInboundAt: Date | null,
): boolean {
  if (!lastOutboundAt) return false;
  if (!lastInboundAt) return true;
  return lastOutboundAt.getTime() > lastInboundAt.getTime();
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type BandsUnit = 'DAYS' | 'HOURS';

/**
 * Índice da faixa (0-based) em `bandsDays` para o tempo parado desde a última
 * outbound. Os limites em `bandsDays` são interpretados na unidade `unit`
 * ('DAYS' default, ou 'HOURS'). Retorna null se a bola não está com o cliente
 * OU se ainda não atingiu a 1ª faixa (< bandsDays[0]).
 */
export function computeBand(params: {
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
  bandsDays: number[];
  now: Date;
  unit?: BandsUnit;
}): number | null {
  const { lastOutboundAt, lastInboundAt, bandsDays, now, unit = 'DAYS' } = params;
  if (!ballIsWithClient(lastOutboundAt, lastInboundAt)) return null;
  const unitMs = unit === 'HOURS' ? HOUR_MS : DAY_MS;
  const elapsed = (now.getTime() - (lastOutboundAt as Date).getTime()) / unitMs;
  let band: number | null = null;
  for (let i = 0; i < bandsDays.length; i++) {
    if (elapsed >= bandsDays[i]) band = i;
  }
  return band;
}

export function isEligibleForReengage(
  band: number | null,
  reengageFromBand: number,
): boolean {
  return band !== null && band >= reengageFromBand;
}
