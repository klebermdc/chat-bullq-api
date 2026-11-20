import { formatReturn, nextOpenAt, type BusinessHoursConfig } from './business-hours.util';

/**
 * Feriado: a agência inteira para e a Aline fica no comando até o fim do dia
 * escolhido. Guardado como instante (`aiHolidayUntil`) para desligar sozinho.
 */

/** Limite de dias à frente — evita feriado esquecido ligado por semanas. */
export const MAX_HOLIDAY_DAYS = 15;

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isHolidayActive(until: Date | null | undefined, now: Date): boolean {
  return !!until && until.getTime() > now.getTime();
}

/** Diferença (min) entre o relógio local de `tz` e UTC no instante `at`. */
function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(at);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((localAsUtc - at.getTime()) / 60_000);
}

function localYmd(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(at);
}

/**
 * "2026-11-20" → instante da meia-noite que encerra esse dia no fuso da
 * agência. Lança erro com texto para o usuário se a data não serve.
 */
export function holidayEndFromDate(date: string, tz: string, now: Date): Date {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error('Data do feriado inválida (use AAAA-MM-DD).');
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const asUtc = new Date(Date.UTC(y, m - 1, d));
  if (asUtc.getUTCMonth() !== m - 1 || asUtc.getUTCDate() !== d) {
    throw new Error('Data do feriado inválida.');
  }

  const today = Date.parse(`${localYmd(now, tz)}T00:00:00Z`);
  const daysAhead = Math.round((asUtc.getTime() - today) / DAY_MS);
  if (daysAhead < 0) throw new Error('A data do feriado já passou.');
  if (daysAhead > MAX_HOLIDAY_DAYS) {
    throw new Error(`O feriado pode ir no máximo ${MAX_HOLIDAY_DAYS} dias à frente.`);
  }

  const midnightAsUtc = Date.UTC(y, m - 1, d + 1);
  const offset = tzOffsetMinutes(tz, new Date(midnightAsUtc));
  return new Date(midnightAsUtc - offset * 60_000);
}

/** Primeira abertura da agenda depois do feriado (24/7 = quando ele acaba). */
export function holidayReturnAt(
  hours: BusinessHoursConfig | null | undefined,
  tz: string,
  until: Date,
): Date {
  if (!hours) return until;
  // Abertura exatamente na virada (agenda que começa 00:00) também vale.
  return nextOpenAt(hours, tz, new Date(until.getTime() - 60_000)) ?? until;
}

/** "segunda-feira às 09h"; passando de uma semana, "dia 01/12 às 09h". */
export function formatHolidayReturn(back: Date, tz: string, now: Date): string {
  const days = Math.round(
    (Date.parse(`${localYmd(back, tz)}T00:00:00Z`) - Date.parse(`${localYmd(now, tz)}T00:00:00Z`)) / DAY_MS,
  );
  const base = formatReturn(back, tz, now);
  if (days < 7) return base;
  const dayMonth = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(back);
  return base.replace(/^.+? às /, `dia ${dayMonth} às `);
}
