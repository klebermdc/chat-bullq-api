/** Formatação das mensagens do Telegram (parse_mode HTML). */

/** Limite da Bot API é 4096; folga para entidades HTML. */
export const TELEGRAM_CHUNK = 4000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < MINUTES_PER_HOUR) return `${total} min`;
  if (total < MINUTES_PER_DAY) {
    const h = Math.floor(total / MINUTES_PER_HOUR);
    return `${h}h${String(total % MINUTES_PER_HOUR).padStart(2, '0')}`;
  }
  const d = Math.floor(total / MINUTES_PER_DAY);
  return `${d}d ${Math.floor((total % MINUTES_PER_DAY) / MINUTES_PER_HOUR)}h`;
}

export function minutesSince(since: Date | string, now: Date): number {
  return (now.getTime() - new Date(since).getTime()) / 60_000;
}

export function formatClock(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(at);
}

export function formatDate(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(at);
}

export function formatPercent(value: number | null): string {
  return value === null ? '–' : `${Math.round(value)}%`;
}

/** Quebra em pedaços de até `max` caracteres, preferindo o fim de linha. */
export function chunkMessage(text: string, max = TELEGRAM_CHUNK): string[] {
  const pieces = text.split('\n').flatMap((line) => splitLong(line, max));
  return pieces.reduce<string[]>((chunks, line) => {
    const last = chunks[chunks.length - 1];
    if (last !== undefined && last.length + 1 + line.length <= max) {
      return [...chunks.slice(0, -1), `${last}\n${line}`];
    }
    return [...chunks, line];
  }, []);
}

function splitLong(line: string, max: number): string[] {
  if (line.length <= max) return [line];
  return Array.from({ length: Math.ceil(line.length / max) }, (_, i) => line.slice(i * max, (i + 1) * max));
}
