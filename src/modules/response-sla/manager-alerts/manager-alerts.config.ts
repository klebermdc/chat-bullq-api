import { parseResponseSlaMinutes } from '../response-sla.rules';

/**
 * Config dos avisos de SLA para a gestão, lida de
 * `organizations.settings.slaManagerAlerts` (opt-in; nenhum código grava —
 * o dono liga por SQL). Exige também `responseSlaMinutes`.
 */

export interface ManagerRecipient {
  name: string;
  /** Só dígitos, com DDI (ex.: 5511947156251). */
  phone: string;
}

export interface ManagerAlertsConfig {
  channelId: string;
  recipients: ManagerRecipient[];
  digestAfterMinutes: number;
  digestIntervalMinutes: number;
  /** Minutos do dia local em que sai o placar (22:10 → 1330). */
  scoreboardMinutes: number;
  digestTemplate: string;
  scoreboardTemplate: string;
  language: string;
}

/** reason null = recurso simplesmente não configurado (não loga). */
export type ParsedManagerAlerts =
  | { ok: true; config: ManagerAlertsConfig }
  | { ok: false; reason: string | null };

export const DEFAULT_DIGEST_AFTER_MINUTES = 30;
export const DEFAULT_DIGEST_INTERVAL_MINUTES = 30;
export const DEFAULT_SCOREBOARD_TIME = '22:10';
export const DEFAULT_DIGEST_TEMPLATE = 'alerta_sla_gestao';
export const DEFAULT_SCOREBOARD_TEMPLATE = 'placar_sla_dia';
export const DEFAULT_TEMPLATE_LANGUAGE = 'pt_BR';
const PHONE_MIN_DIGITS = 10;
const PHONE_MAX_DIGITS = 15;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

type Raw = Record<string, unknown>;

function isObject(v: unknown): v is Raw {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function off(reason: string): ParsedManagerAlerts {
  return { ok: false, reason };
}

/** Inteiro positivo; ausente → padrão; presente e inválido → null. */
function positiveInt(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return null;
  return Math.floor(value);
}

function nonEmpty(value: unknown, fallback: string): string | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.trim();
}

function parseRecipient(value: unknown): ManagerRecipient | null {
  if (!isObject(value) || typeof value.name !== 'string' || typeof value.phone !== 'string') {
    return null;
  }
  const name = value.name.trim();
  const phone = value.phone.replace(/\D/g, '');
  if (!name || phone.length < PHONE_MIN_DIGITS || phone.length > PHONE_MAX_DIGITS) return null;
  return { name, phone };
}

function parseHhmm(value: unknown): number | null {
  const text = value === undefined ? DEFAULT_SCOREBOARD_TIME : value;
  if (typeof text !== 'string') return null;
  const match = HHMM.exec(text.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function parseRecipients(value: unknown): ManagerRecipient[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed = value.map(parseRecipient);
  return parsed.every((r): r is ManagerRecipient => r !== null) ? parsed : null;
}

export function parseManagerAlertsConfig(settings: unknown): ParsedManagerAlerts {
  if (!isObject(settings) || settings.slaManagerAlerts === undefined) {
    return { ok: false, reason: null };
  }
  const raw = settings.slaManagerAlerts;
  if (!isObject(raw)) return off('slaManagerAlerts não é um objeto');
  if (parseResponseSlaMinutes(settings) === null) {
    return off('responseSlaMinutes ausente: o SLA de resposta precisa estar ligado');
  }

  const channelId = nonEmpty(raw.channelId, '');
  if (!channelId) return off('channelId ausente');
  const recipients = parseRecipients(raw.recipients);
  if (!recipients) return off('recipients vazio ou com nome/telefone inválido');

  const fields = {
    digestAfterMinutes: positiveInt(raw.digestAfterMinutes, DEFAULT_DIGEST_AFTER_MINUTES),
    digestIntervalMinutes: positiveInt(raw.digestIntervalMinutes, DEFAULT_DIGEST_INTERVAL_MINUTES),
    scoreboardMinutes: parseHhmm(raw.scoreboardTime),
    digestTemplate: nonEmpty(raw.digestTemplate, DEFAULT_DIGEST_TEMPLATE),
    scoreboardTemplate: nonEmpty(raw.scoreboardTemplate, DEFAULT_SCOREBOARD_TEMPLATE),
    language: nonEmpty(raw.language, DEFAULT_TEMPLATE_LANGUAGE),
  };
  const invalid = Object.entries(fields).find(([, v]) => v === null);
  if (invalid) return off(`${invalid[0]} inválido`);

  return {
    ok: true,
    config: { channelId, recipients, ...(fields as Omit<ManagerAlertsConfig, 'channelId' | 'recipients'>) },
  };
}
