import { localParts } from '../routing/availability/business-hours.util';

/** Regras puras de quando o pulso sai (sem banco nem Redis). */

export type PulseKind = 'hourly' | 'closing';
export const PULSE_KINDS: ReadonlyArray<PulseKind> = ['hourly', 'closing'];

const MINUTES_PER_HOUR = 60;

/** Hora (0–23) de `now` no fuso da org. */
export function localHour(now: Date, tz: string): number {
  return Math.floor(localParts(now, tz).minutes / MINUTES_PER_HOUR);
}

/**
 * Na hora do fechamento sai o fechamento (sempre). Antes dela, o pulso sai só
 * se alguém está dentro do próprio horário — fim de semana se resolve sozinho.
 * Depois do fechamento, nada.
 */
export function decidePulse(input: {
  hour: number;
  closingHour: number;
  anyoneWithinHours: boolean;
}): PulseKind | null {
  if (input.hour === input.closingHour) return 'closing';
  if (input.hour < input.closingHour && input.anyoneWithinHours) return 'hourly';
  return null;
}

/** Quem está dentro do próprio horário agora (sem horário configurado fica de fora). */
export function withinHoursMembers<T extends { schedule: { withinHours: boolean | null } }>(
  rows: ReadonlyArray<T>,
): T[] {
  return rows.filter((r) => r.schedule.withinHours === true);
}
