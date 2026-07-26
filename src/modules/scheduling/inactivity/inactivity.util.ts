export function ballIsWithClient(
  lastOutboundAt: Date | null,
  lastInboundAt: Date | null,
): boolean {
  if (!lastOutboundAt) return false;
  if (!lastInboundAt) return true;
  return lastOutboundAt.getTime() > lastInboundAt.getTime();
}

const HOUR_MS = 60 * 60 * 1000;

export type BandsUnit = 'DAYS' | 'HOURS';

/** Converte o valor de uma faixa para horas conforme a unidade. */
export function bandHours(value: number, unit: BandsUnit): number {
  return unit === 'HOURS' ? value : value * 24;
}

/**
 * Índice da faixa (0-based) para o tempo parado desde a última outbound. Cada
 * faixa `bandsDays[i]` é interpretada na unidade `units[i]` ('DAYS' default) —
 * permite escada mista (ex.: 3h, 6h, 3d). Assume `bandsDays`/`units` já
 * ordenados por tempo absoluto crescente. Retorna null se a bola não está com o
 * cliente OU se ainda não atingiu a 1ª faixa.
 */
export function computeBand(params: {
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
  bandsDays: number[];
  now: Date;
  units?: BandsUnit[];
}): number | null {
  const { lastOutboundAt, lastInboundAt, bandsDays, now, units } = params;
  if (!ballIsWithClient(lastOutboundAt, lastInboundAt)) return null;
  const elapsedH = (now.getTime() - (lastOutboundAt as Date).getTime()) / HOUR_MS;
  let band: number | null = null;
  for (let i = 0; i < bandsDays.length; i++) {
    if (elapsedH >= bandHours(bandsDays[i], units?.[i] ?? 'DAYS')) band = i;
  }
  return band;
}

export function isEligibleForReengage(
  band: number | null,
  reengageFromBand: number,
): boolean {
  return band !== null && band >= reengageFromBand;
}
