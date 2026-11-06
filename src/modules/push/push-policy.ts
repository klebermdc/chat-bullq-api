import { NotificationType } from '@prisma/client';

export const DEFAULT_PUSH_TIMEZONE = 'America/Sao_Paulo';

export interface PushPreference {
  type: NotificationType;
  browserPush: boolean;
  dndStart: string | null;
  dndEnd: string | null;
}

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutos desde a meia-noite no fuso dado. */
function minutesInTimezone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

/**
 * Janela Não-Perturbe (HH:MM, pode cruzar a meia-noite), a mesma regra do
 * `isWithinDnd` da web, mas no fuso da empresa: o servidor não sabe o fuso
 * do aparelho.
 */
export function isWithinDnd(
  start: string | null,
  end: string | null,
  now: Date,
  timeZone: string = DEFAULT_PUSH_TIMEZONE,
): boolean {
  if (!start || !end) return false;
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null) return false;
  const cur = minutesInTimezone(now, timeZone);
  return s <= e ? cur >= s && cur < e : cur >= s || cur < e;
}

/**
 * A preferência do tipo deixa sair push? Preferência ausente = ligada (mesmo
 * default do `prefFor` da web). Desligada ou dentro do Não-Perturbe = não.
 */
export function preferenceAllowsPush(
  pref: PushPreference | undefined,
  now: Date,
  timeZone: string = DEFAULT_PUSH_TIMEZONE,
): boolean {
  if (!pref) return true;
  if (!pref.browserPush) return false;
  return !isWithinDnd(pref.dndStart, pref.dndEnd, now, timeZone);
}
