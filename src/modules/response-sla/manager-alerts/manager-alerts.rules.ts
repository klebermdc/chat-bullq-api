import { localParts } from '../../routing/availability/business-hours.util';

/** Regras puras de horário dos avisos à gestão (sem banco nem Redis). */

/** Silêncio para a gestão: 22:30 até 08:00 no fuso da org. */
export const QUIET_START_MINUTES = 22 * 60 + 30;
export const QUIET_END_MINUTES = 8 * 60;
/** Tique perdido (deploy, Redis fora) ainda manda o placar até 1h depois. */
export const SCOREBOARD_CATCHUP_MINUTES = 60;

const MINUTE_MS = 60_000;

export function isQuietHours(now: Date, tz: string): boolean {
  const { minutes } = localParts(now, tz);
  return minutes >= QUIET_START_MINUTES || minutes < QUIET_END_MINUTES;
}

export function isScoreboardDue(now: Date, tz: string, scoreboardMinutes: number): boolean {
  const { minutes } = localParts(now, tz);
  return minutes >= scoreboardMinutes && minutes < scoreboardMinutes + SCOREBOARD_CATCHUP_MINUTES;
}

/** AAAA-MM-DD do dia local (chave do placar diário). */
export function localDateKey(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Meia-noite local de hoje. Desloca pelo minuto do dia (mesma aproximação de
 * `business-minutes.util`: correto sem horário de verão).
 */
export function localDayStart(now: Date, tz: string): Date {
  const { minutes } = localParts(now, tz);
  const minuteStart = now.getTime() - (now.getTime() % MINUTE_MS);
  return new Date(minuteStart - minutes * MINUTE_MS);
}
