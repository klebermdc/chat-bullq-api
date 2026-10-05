import { BadRequestException } from '@nestjs/common';
import { shiftDayKey, startOfZonedDay, toZonedDayKey } from './zoned-day.util';

export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface UsageRange {
  from: Date;
  to: Date;
}

function parseDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} não é uma data válida`);
  }
  return date;
}

/**
 * Resolve o intervalo [from, to) dos relatórios de custo/entrega.
 * Sem parâmetros = últimos 30 dias de São Paulo (hoje incluído) até agora.
 * Recusa intervalo invertido/vazio e intervalo maior que 366 dias.
 */
export function resolveUsageRange(
  query: { from?: string; to?: string },
  now: Date = new Date(),
): UsageRange {
  const to = query.to ? parseDate(query.to, 'to') : now;

  let from: Date;
  if (query.from) {
    from = parseDate(query.from, 'from');
  } else if (query.to) {
    from = new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
  } else {
    const firstDay = shiftDayKey(toZonedDayKey(now), -(DEFAULT_RANGE_DAYS - 1));
    from = startOfZonedDay(firstDay);
  }

  if (from.getTime() >= to.getTime()) {
    throw new BadRequestException('from deve ser anterior a to');
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new BadRequestException(
      `O intervalo máximo é de ${MAX_RANGE_DAYS} dias`,
    );
  }
  return { from, to };
}
