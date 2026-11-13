import { BadRequestException } from '@nestjs/common';
import { localDayBounds, parseScoreboardDate } from '../dashboard/daily-scoreboard/daily-scoreboard.rules';

/** Período em dias locais (inclusivos) e o intervalo UTC que vai para a Meta. */
export interface CostPeriod {
  from: string;
  to: string;
  start: Date;
  end: Date;
}

export const MAX_PERIOD_DAYS = 92;
const DAY_MS = 24 * 60 * 60_000;

function localToday(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Sem datas: do dia 1º do mês corrente até hoje. O fim nunca passa de agora. */
export function resolvePeriod(tz: string, now: Date, from?: string, to?: string): CostPeriod {
  const today = localToday(now, tz);
  const end = to ? parseScoreboardDate(to) : today;
  const start = from ? parseScoreboardDate(from) : `${(end ?? today).slice(0, 8)}01`;
  if (!start || !end) throw new BadRequestException('Datas precisam ser YYYY-MM-DD');
  if (start > end) throw new BadRequestException('Início depois do fim');
  const startAt = localDayBounds(start, tz).start;
  const endAt = new Date(Math.min(localDayBounds(end, tz).end.getTime(), now.getTime()));
  if (endAt.getTime() - startAt.getTime() > MAX_PERIOD_DAYS * DAY_MS) {
    throw new BadRequestException(`Período maior que ${MAX_PERIOD_DAYS} dias`);
  }
  if (endAt <= startAt) throw new BadRequestException('Período no futuro');
  return { from: start, to: end, start: startAt, end: endAt };
}
