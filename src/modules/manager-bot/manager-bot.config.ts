/**
 * Config do gerente no Telegram, lida de `organizations.settings.managerBot`.
 * Opt-in: sem `enabled: true` o recurso fica desligado em silêncio.
 * O cadastro (`/start <código>`) é o único ponto que grava `chats` e `linkCode`.
 */

export interface ManagerChat {
  /** Id do chat no Telegram, sempre como texto. */
  chatId: string;
  name: string;
}

export interface ManagerBotConfig {
  chats: ManagerChat[];
  /** Código de uso único do `/start`; null = cadastro fechado. */
  linkCode: string | null;
  /** Minutos do dia local (09:00 → 540). */
  openingMinutes: number;
  closingMinutes: number;
  slaAlertAfterMinutes: number;
  alertIntervalMinutes: number;
  queueThreshold: number;
  offlineMinutes: number;
}

export type ParsedManagerBot = { ok: true; config: ManagerBotConfig } | { ok: false; reason: string | null };

export const DEFAULT_OPENING_TIME = '09:00';
export const DEFAULT_CLOSING_TIME = '22:10';
export const DEFAULT_SLA_ALERT_AFTER_MINUTES = 30;
export const DEFAULT_ALERT_INTERVAL_MINUTES = 30;
export const DEFAULT_QUEUE_THRESHOLD = 10;
export const DEFAULT_OFFLINE_MINUTES = 30;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const CHAT_ID = /^-?\d{1,20}$/;

type Raw = Record<string, unknown>;

function isObject(v: unknown): v is Raw {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function positiveInt(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return null;
  return Math.floor(value);
}

function parseHhmm(value: unknown, fallback: string): number | null {
  const text = value === undefined ? fallback : value;
  if (typeof text !== 'string') return null;
  const match = HHMM.exec(text.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function parseChat(value: unknown): ManagerChat | null {
  if (!isObject(value) || typeof value.name !== 'string') return null;
  const chatId = String(value.chatId ?? '').trim();
  const name = value.name.trim();
  return name && CHAT_ID.test(chatId) ? { chatId, name } : null;
}

function parseChats(value: unknown): ManagerChat[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const chats = value.map(parseChat);
  return chats.every((c): c is ManagerChat => c !== null) ? chats : null;
}

export function parseManagerBotConfig(settings: unknown): ParsedManagerBot {
  if (!isObject(settings) || !isObject(settings.managerBot)) return { ok: false, reason: null };
  const raw = settings.managerBot;
  if (raw.enabled !== true) return { ok: false, reason: null };

  const chats = parseChats(raw.chats);
  if (!chats) return { ok: false, reason: 'chats com id ou nome inválido' };
  const linkCode = typeof raw.linkCode === 'string' && raw.linkCode.trim() ? raw.linkCode.trim() : null;

  const fields = {
    openingMinutes: parseHhmm(raw.openingTime, DEFAULT_OPENING_TIME),
    closingMinutes: parseHhmm(raw.closingTime, DEFAULT_CLOSING_TIME),
    slaAlertAfterMinutes: positiveInt(raw.slaAlertAfterMinutes, DEFAULT_SLA_ALERT_AFTER_MINUTES),
    alertIntervalMinutes: positiveInt(raw.alertIntervalMinutes, DEFAULT_ALERT_INTERVAL_MINUTES),
    queueThreshold: positiveInt(raw.queueThreshold, DEFAULT_QUEUE_THRESHOLD),
    offlineMinutes: positiveInt(raw.offlineMinutes, DEFAULT_OFFLINE_MINUTES),
  };
  const invalid = Object.entries(fields).find(([, v]) => v === null);
  if (invalid) return { ok: false, reason: `${invalid[0]} inválido` };

  return {
    ok: true,
    config: { chats, linkCode, ...(fields as Omit<ManagerBotConfig, 'chats' | 'linkCode'>) },
  };
}
