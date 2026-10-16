import { DATES_TO_BE_DEFINED_TEXT, PARKS } from '../contracts.constants';

export interface ParkDate {
  parkId: string;
  date: string; // YYYY-MM-DD
}

export interface ContractDate {
  parkId: string | null;
  label: string;
  date: string; // YYYY-MM-DD
}

/** Datas legadas sem ano mais de 30 dias antes da criação são do ano seguinte. */
const PAST_TOLERANCE_DAYS = 30;
const DAY_MS = 86_400_000;

function labelFor(parkId: string): string {
  return PARKS.find((p) => p.id === parkId)?.label ?? parkId;
}

function parkIdFor(label: string): string | null {
  const norm = label.trim().toLowerCase();
  return PARKS.find((p) => p.label.toLowerCase() === norm)?.id ?? null;
}

function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function formatParkDates(parkDates: ParkDate[]): string {
  if (!parkDates.length) return DATES_TO_BE_DEFINED_TEXT;
  return [...parkDates]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ parkId, date }) => {
      const [y, m, d] = date.split('-');
      return `${d}/${m}/${y} - ${labelFor(parkId)}`;
    })
    .join('\n');
}

function parseLegacyLine(line: string, createdAt: Date): ContractDate | null {
  const match = /^\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s*-\s*(.+?)\s*$/.exec(line);
  if (!match) return null;
  const d = Number(match[1]);
  const m = Number(match[2]);
  let y = match[3] ? Number(match[3]) : createdAt.getUTCFullYear();
  if (!match[3]) {
    const candidate = Date.UTC(y, m - 1, d);
    if (candidate < createdAt.getTime() - PAST_TOLERANCE_DAYS * DAY_MS) y += 1;
  }
  if (!isRealDate(y, m, d)) return null;
  const label = match[4];
  return { parkId: parkIdFor(label), label, date: iso(y, m, d) };
}

/** Datas do contrato: estruturadas quando existem, senão lidas do texto legado. */
export function readContractDates(c: {
  parkDates: unknown;
  requestedDates: string;
  createdAt: Date;
}): ContractDate[] {
  const structured = Array.isArray(c.parkDates) ? (c.parkDates as ParkDate[]) : [];
  if (structured.length) {
    return structured
      .map((p) => ({ parkId: p.parkId, label: labelFor(p.parkId), date: p.date }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  return (c.requestedDates ?? '')
    .split('\n')
    .map((line) => parseLegacyLine(line, c.createdAt))
    .filter((x): x is ContractDate => x !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}
