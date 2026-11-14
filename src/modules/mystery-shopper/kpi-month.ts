import { BadRequestException } from '@nestjs/common';
import { dayKey, dayRange } from '../attendant-diary/diary-day';

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTHS_PER_YEAR = 12;

export interface KpiMonthRange {
  /** `YYYY-MM` */
  month: string;
  /** Início (inclusivo) do mês no fuso da org. */
  start: Date;
  /** Fim (exclusivo) do mês no fuso da org. */
  end: Date;
  /** Início do mês anterior (o fim dele é `start`). */
  previousStart: Date;
}

/** Soma `delta` meses a `YYYY-MM`. */
function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const index = year * MONTHS_PER_YEAR + (monthNumber - 1) + delta;
  const shiftedYear = Math.floor(index / MONTHS_PER_YEAR);
  const shiftedMonth = (index % MONTHS_PER_YEAR) + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, '0')}`;
}

const invalidMonth = () => new BadRequestException('Mês inválido: use o formato AAAA-MM (ex.: 2026-11).');

const monthStart = (month: string, timeZone: string): Date => dayRange(`${month}-01`, timeZone).from;

/**
 * `?month=YYYY-MM` → limites do mês no fuso da org. Sem mês = mês atual nesse fuso.
 * Formato inválido = 400.
 */
export function resolveKpiMonth(month: string | undefined, now: Date, timeZone: string): KpiMonthRange {
  if (month !== undefined && typeof month !== 'string') throw invalidMonth(); // ?month=a&month=b chega como array
  const resolved = month ? month.trim() : dayKey(now, timeZone).slice(0, 7);
  if (!MONTH_PATTERN.test(resolved)) throw invalidMonth();
  return {
    month: resolved,
    start: monthStart(resolved, timeZone),
    end: monthStart(shiftMonth(resolved, 1), timeZone),
    previousStart: monthStart(shiftMonth(resolved, -1), timeZone),
  };
}
