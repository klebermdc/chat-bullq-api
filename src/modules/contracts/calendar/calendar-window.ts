import { BadRequestException } from '@nestjs/common';
import { addDays, CALENDAR_TIME_ZONE } from './calendar-events';
import type { CalendarWindow } from './contract-calendar.service';

export const DEFAULT_WINDOW_DAYS = 90;
export const MAX_WINDOW_DAYS = 180;
const DAY_MS = 86_400_000;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "Hoje" no fuso dos parques (lembrete de Multipass é às 7h de Orlando). */
export const todayInOrlando = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: CALENDAR_TIME_ZONE }).format(now);

function assertRealDate(name: string, value: string): void {
  const m = ISO_DATE_RE.exec(value);
  const ok = m !== null && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) === value;
  if (!ok) throw new BadRequestException(`${name} inválido: use uma data real no formato YYYY-MM-DD`);
}

/** Padrões: from = hoje em Orlando; to = from + 90 dias. Janela máxima de 180 dias. */
export function resolveCalendarWindow(q: { from?: string; to?: string }, today: string): CalendarWindow {
  const from = q.from ?? today;
  const to = q.to ?? addDays(from, DEFAULT_WINDOW_DAYS);
  assertRealDate('from', from);
  assertRealDate('to', to);
  if (to < from) throw new BadRequestException('to deve ser igual ou depois de from');
  const days = (Date.parse(to) - Date.parse(from)) / DAY_MS;
  if (days > MAX_WINDOW_DAYS) throw new BadRequestException(`janela máxima de ${MAX_WINDOW_DAYS} dias`);
  return { from, to, today };
}
