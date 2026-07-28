export interface BusinessHoursDay {
  enabled: boolean;
  windows?: Array<[string, string]>; // [["09:00","18:00"]]
}
export type BusinessHoursConfig = Record<string, BusinessHoursDay>;

// index 0 = sunday, alinhado com Intl weekday
const DAY_KEYS = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
] as const;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((v) => parseInt(v, 10));
  return (h || 0) * 60 + (m || 0);
}

// weekday (0=sunday) + minutos-do-dia de `at` no fuso `tz`
function localParts(at: Date, tz: string): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at);
  const weekday = parts.find((p) => p.type === 'weekday')?.value.toLowerCase() ?? '';
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '00', 10) % 24;
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '00', 10);
  const dow = DAY_KEYS.indexOf(weekday as (typeof DAY_KEYS)[number]);
  return { dow: dow < 0 ? 0 : dow, minutes: hour * 60 + minute };
}

// janelas [inicioMin, fimMin] do dia `dow`; enabled sem windows = dia todo
function dayWindows(config: BusinessHoursConfig, dow: number): Array<[number, number]> {
  const day = config[DAY_KEYS[dow]];
  if (!day || !day.enabled) return [];
  const windows = day.windows ?? [];
  if (windows.length === 0) return [[0, 1440]];
  return windows.map(([f, t]) => [toMinutes(f), toMinutes(t)] as [number, number]);
}

export function isWithinHours(
  config: BusinessHoursConfig | null | undefined, tz: string, now: Date,
): boolean {
  if (!config) return true; // 24/7
  const { dow, minutes } = localParts(now, tz);
  return dayWindows(config, dow).some(([f, t]) => minutes >= f && minutes < t);
}

// Próxima abertura no futuro (varre até 7 dias). null se nada habilitado.
// Aproxima o offset como delta de minutos a partir de `now` — correto onde
// não há horário de verão (Brasil não tem desde 2019).
export function nextOpenAt(
  config: BusinessHoursConfig | null | undefined, tz: string, now: Date,
): Date | null {
  if (!config) return null;
  const { dow, minutes } = localParts(now, tz);
  for (let offset = 0; offset <= 7; offset++) {
    const d = (dow + offset) % 7;
    const starts = dayWindows(config, d).map((w) => w[0]).sort((a, b) => a - b);
    for (const start of starts) {
      const deltaMin = offset * 1440 + start - minutes;
      if (deltaMin > 0) return new Date(now.getTime() + deltaMin * 60000);
    }
  }
  return null;
}

// Fim da janela mais recente antes de `now` (= início do período fechado atual).
export function previousCloseAt(
  config: BusinessHoursConfig | null | undefined, tz: string, now: Date,
): Date | null {
  if (!config) return null;
  const { dow, minutes } = localParts(now, tz);
  for (let offset = 0; offset <= 7; offset++) {
    const d = ((dow - offset) % 7 + 7) % 7;
    const ends = dayWindows(config, d).map((w) => w[1]).sort((a, b) => b - a);
    for (const end of ends) {
      const deltaMin = end - offset * 1440 - minutes;
      if (deltaMin <= 0) return new Date(now.getTime() + deltaMin * 60000);
    }
  }
  return null;
}

// "hoje às 09h" / "amanhã às 09h30" / "segunda-feira às 09h"
export function formatReturn(date: Date, tz: string, now: Date): string {
  const ymd = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d); // YYYY-MM-DD
  const days = Math.round(
    (Date.parse(`${ymd(date)}T00:00:00Z`) - Date.parse(`${ymd(now)}T00:00:00Z`)) / 86400000,
  );
  const hp = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const hh = hp.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = hp.find((p) => p.type === 'minute')?.value ?? '00';
  const hora = mm === '00' ? `${hh}h` : `${hh}h${mm}`;
  let dia: string;
  if (days <= 0) dia = 'hoje';
  else if (days === 1) dia = 'amanhã';
  else dia = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, weekday: 'long' }).format(date);
  return `${dia} às ${hora}`;
}

// "seg: 09h às 18h; sáb: 09h às 13h30". null se nada habilitado.
export function formatHoursSummary(
  config: BusinessHoursConfig | null | undefined,
): string | null {
  if (!config) return null;
  const LABELS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const hhmm = (v: string) => {
    const [h, m] = v.split(':');
    return m === '00' ? `${h}h` : `${h}h${m}`;
  };
  const parts: string[] = [];
  for (let d = 0; d < 7; d++) {
    const day = config[DAY_KEYS[d]];
    if (!day || !day.enabled) continue;
    const windows = day.windows ?? [];
    const w =
      windows.length === 0
        ? 'o dia todo'
        : windows.map(([f, t]) => `${hhmm(f)} às ${hhmm(t)}`).join(' e ');
    parts.push(`${LABELS[d]}: ${w}`);
  }
  return parts.length ? parts.join('; ') : null;
}
