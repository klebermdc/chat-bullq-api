import {
  DEFAULT_TEMPLATE_LANGUAGE,
  isObject,
  nonEmpty,
  parseRecipients,
  type ManagerRecipient,
} from '../response-sla/manager-alerts/manager-alerts.config';

/**
 * Config do pulso do atendimento, lida de `organizations.settings.teamPulse`
 * (opt-in; nenhum código grava — o dono liga por SQL). Ausente = desligado.
 */

export interface TeamPulseConfig {
  /** Canal WhatsApp oficial que manda o template. */
  channelId: string;
  recipients: ManagerRecipient[];
  hourlyTemplate: string;
  closingTemplate: string;
  language: string;
  /** Hora local do fechamento; o pulso de hora em hora vai até antes dela. */
  closingHour: number;
}

/** reason null = recurso simplesmente não configurado (não loga). */
export type ParsedTeamPulse = { ok: true; config: TeamPulseConfig } | { ok: false; reason: string | null };

export const DEFAULT_HOURLY_TEMPLATE = 'pulso_atendimento';
export const DEFAULT_CLOSING_TEMPLATE = 'fechamento_atendimento';
export const DEFAULT_CLOSING_HOUR = 22;
const MIN_HOUR = 0;
const MAX_HOUR = 23;

function off(reason: string): ParsedTeamPulse {
  return { ok: false, reason };
}

function parseHour(value: unknown): number | null {
  if (value === undefined) return DEFAULT_CLOSING_HOUR;
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= MIN_HOUR && value <= MAX_HOUR ? value : null;
}

export function parseTeamPulseConfig(settings: unknown): ParsedTeamPulse {
  if (!isObject(settings) || settings.teamPulse === undefined) return { ok: false, reason: null };
  const raw = settings.teamPulse;
  if (!isObject(raw)) return off('teamPulse não é um objeto');

  const channelId = nonEmpty(raw.channelId, '');
  if (!channelId) return off('channelId ausente');
  const recipients = parseRecipients(raw.recipients);
  if (!recipients) return off('recipients vazio ou com nome/telefone inválido');

  const fields = {
    hourlyTemplate: nonEmpty(raw.hourlyTemplate, DEFAULT_HOURLY_TEMPLATE),
    closingTemplate: nonEmpty(raw.closingTemplate, DEFAULT_CLOSING_TEMPLATE),
    language: nonEmpty(raw.language, DEFAULT_TEMPLATE_LANGUAGE),
    closingHour: parseHour(raw.closingHour),
  };
  const invalid = Object.entries(fields).find(([, v]) => v === null);
  if (invalid) return off(`${invalid[0]} inválido`);

  return {
    ok: true,
    config: { channelId, recipients, ...(fields as Omit<TeamPulseConfig, 'channelId' | 'recipients'>) },
  };
}
