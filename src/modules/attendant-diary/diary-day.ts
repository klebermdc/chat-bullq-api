const DAY_MS = 24 * 60 * 60 * 1000;

const dayKey = (date: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);

/** Diferença, em ms, entre o relógio local do fuso e o UTC naquele instante. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return asUtc - instant.getTime();
}

function localMidnight(day: string, timeZone: string): Date {
  const utcMidnight = new Date(`${day}T00:00:00Z`);
  return new Date(utcMidnight.getTime() - zoneOffsetMs(utcMidnight, timeZone));
}

/** Início (inclusivo) e fim (exclusivo) de um dia `YYYY-MM-DD` no fuso. */
export function dayRange(day: string, timeZone: string): { from: Date; to: Date } {
  const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS)
    .toISOString()
    .slice(0, 10);
  return { from: localMidnight(day, timeZone), to: localMidnight(nextDay, timeZone) };
}

/** O dia anterior a `now`, no calendário do fuso. */
export function previousDayKey(now: Date, timeZone: string): string {
  const today = dayKey(now, timeZone);
  return new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` de um dia que existe no calendário (recusa 2026-02-31). */
export function isValidDay(day: string): boolean {
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}
