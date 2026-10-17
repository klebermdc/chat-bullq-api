/**
 * Dias de calendário no fuso do relatório (São Paulo), sem biblioteca de data:
 * só `Intl.DateTimeFormat`. Chave de dia = 'YYYY-MM-DD'.
 */
export const USAGE_TIME_ZONE = 'America/Sao_Paulo';

const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: USAGE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function zonedParts(date: Date): Record<string, number> {
  const parts: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts;
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, '0');
}

function utcKey(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

function parseDayKey(dayKey: string): { year: number; month: number; day: number } {
  const match = DAY_KEY_PATTERN.exec(dayKey);
  if (!match) throw new Error(`Dia inválido (esperado YYYY-MM-DD): ${dayKey}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (utcKey(Date.UTC(year, month - 1, day)) !== dayKey) {
    throw new Error(`Dia inexistente no calendário: ${dayKey}`);
  }
  return { year, month, day };
}

/** Diferença (ms) entre o relógio de parede do fuso e o UTC naquele instante. */
function zoneOffsetMs(date: Date): number {
  const p = zonedParts(date);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Dia de São Paulo em que o instante cai. */
export function toZonedDayKey(date: Date): string {
  const p = zonedParts(date);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Soma (ou subtrai) dias de calendário a uma chave de dia. */
export function shiftDayKey(dayKey: string, days: number): string {
  const { year, month, day } = parseDayKey(dayKey);
  return utcKey(Date.UTC(year, month - 1, day + days));
}

/** Instante UTC da meia-noite (início) daquele dia em São Paulo. */
export function startOfZonedDay(dayKey: string): Date {
  const { year, month, day } = parseDayKey(dayKey);
  const utcMidnight = Date.UTC(year, month - 1, day);
  // Duas passadas: a 1ª estima o offset, a 2ª corrige se o offset mudou
  // entre a estimativa e a meia-noite local (transição de horário de verão).
  const estimate = utcMidnight - zoneOffsetMs(new Date(utcMidnight));
  return new Date(utcMidnight - zoneOffsetMs(new Date(estimate)));
}

/** Todos os dias de São Paulo tocados pelo intervalo [from, to). */
export function listZonedDayKeys(from: Date, to: Date): string[] {
  if (to.getTime() <= from.getTime()) return [];
  const last = toZonedDayKey(new Date(to.getTime() - 1));
  const days: string[] = [];
  for (let key = toZonedDayKey(from); key <= last; key = shiftDayKey(key, 1)) {
    days.push(key);
  }
  return days;
}
