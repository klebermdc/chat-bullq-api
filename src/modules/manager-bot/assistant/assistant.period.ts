import { localDayBounds, parseScoreboardDate } from '../../dashboard/daily-scoreboard/daily-scoreboard.rules';
import type { Range } from '../manager-bot.rules';

/** Período máximo que uma ferramenta aceita (evita varrer o banco inteiro). */
export const MAX_PERIOD_DAYS = 90;
const DAY_MS = 24 * 60 * 60_000;

export class ToolInputError extends Error {}

/** "YYYY-MM-DD" (início e fim inclusivos, dia local) → intervalo UTC [from, to). */
export function parsePeriod(inicio: unknown, fim: unknown, tz: string): Range {
  const start = typeof inicio === 'string' ? parseScoreboardDate(inicio.trim()) : null;
  const end = typeof fim === 'string' ? parseScoreboardDate(fim.trim()) : null;
  if (!start || !end) throw new ToolInputError('inicio e fim precisam ser datas YYYY-MM-DD');
  if (start > end) throw new ToolInputError('inicio depois do fim');
  const range = { from: localDayBounds(start, tz).start, to: localDayBounds(end, tz).end };
  if (range.to.getTime() - range.from.getTime() > MAX_PERIOD_DAYS * DAY_MS + DAY_MS) {
    throw new ToolInputError(`período maior que ${MAX_PERIOD_DAYS} dias`);
  }
  return range;
}

export function parseOptionalDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = typeof value === 'string' ? parseScoreboardDate(value.trim()) : null;
  if (!date) throw new ToolInputError('data precisa ser YYYY-MM-DD');
  return date;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Filtro por nome sem acento e por pedaço ("barbara" acha "Bárbara Lima"). */
export function matchesAgent(name: string | null | undefined, filter: unknown): boolean {
  if (typeof filter !== 'string' || !filter.trim()) return true;
  return normalize(name ?? '').includes(normalize(filter));
}
