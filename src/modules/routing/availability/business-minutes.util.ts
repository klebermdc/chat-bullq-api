import {
  dayWindows,
  localParts,
  type BusinessHoursConfig,
} from './business-hours.util';

/**
 * Minutos úteis: tempo contado só dentro das janelas de expediente.
 *
 * Mesma aproximação de `nextOpenAt`: o fuso vira um deslocamento fixo em
 * minutos a partir do instante inicial. Correto onde não há horário de verão
 * (Brasil não tem desde 2019).
 *
 * Janela com fim <= início (ex.: 22:00–02:00) é ignorada, igual ao
 * `isWithinHours`, que nunca a considera aberta.
 */

const MINUTE_MS = 60_000;
const DAY_MINUTES = 1440;
/** Varredura máxima para achar o prazo. Sem janela em 14 dias → sem prazo. */
export const DEADLINE_SCAN_DAYS = 14;

type Interval = readonly [number, number]; // [inícioMs, fimMs)

/**
 * Janelas abertas (em ms absolutos) de `from` até `days` dias depois,
 * ordenadas e já recortadas para começar em `from`.
 */
function openIntervals(
  config: BusinessHoursConfig,
  tz: string,
  from: Date,
  days: number,
): Interval[] {
  const fromMs = from.getTime();
  const baseMs = fromMs - (fromMs % MINUTE_MS); // minuto cheio
  const { dow, minutes } = localParts(new Date(baseMs), tz);
  const toAbs = (dayOffset: number, localMin: number) =>
    baseMs + (dayOffset * DAY_MINUTES + localMin - minutes) * MINUTE_MS;

  const intervals: Interval[] = [];
  for (let offset = 0; offset <= days; offset++) {
    const windows = dayWindows(config, (dow + offset) % 7)
      .filter(([start, end]) => end > start)
      .sort((a, b) => a[0] - b[0]);
    for (const [start, end] of windows) {
      const s = Math.max(toAbs(offset, start), fromMs);
      const e = toAbs(offset, end);
      if (e > s) intervals.push([s, e]);
    }
  }
  return intervals;
}

/**
 * Instante em que se completam `minutes` minutos úteis a partir de `start`.
 * Config null = 24/7. Sem nenhuma janela em 14 dias → null.
 *
 * Um prazo que fecharia exatamente no fim de uma janela vai para a próxima
 * abertura: no relógio útil é o mesmo instante, e assim o alerta nunca cai
 * no minuto em que o expediente já acabou.
 */
export function addBusinessMinutes(
  config: BusinessHoursConfig | null | undefined,
  tz: string,
  start: Date,
  minutes: number,
): Date | null {
  if (!config) return new Date(start.getTime() + minutes * MINUTE_MS);

  let remaining = minutes * MINUTE_MS;
  for (const [s, e] of openIntervals(config, tz, start, DEADLINE_SCAN_DAYS)) {
    const length = e - s;
    if (remaining < length) return new Date(s + remaining);
    remaining -= length;
  }
  return null;
}

/** Minutos úteis entre `from` e `to` (0 se `to` <= `from`). Config null = 24/7. */
export function businessMinutesBetween(
  config: BusinessHoursConfig | null | undefined,
  tz: string,
  from: Date,
  to: Date,
): number {
  const spanMs = to.getTime() - from.getTime();
  if (spanMs <= 0) return 0;
  if (!config) return spanMs / MINUTE_MS;

  const days = Math.ceil(spanMs / (DAY_MINUTES * MINUTE_MS)) + 1;
  const toMs = to.getTime();
  const totalMs = openIntervals(config, tz, from, days).reduce(
    (sum, [s, e]) => sum + Math.max(0, Math.min(e, toMs) - s),
    0,
  );
  return totalMs / MINUTE_MS;
}
