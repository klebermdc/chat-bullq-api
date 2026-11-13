/**
 * Regras puras da ligação de retorno de cotação (F6). Sem banco nem rede.
 *
 * Chave por agência em `organizations.settings.voiceCalls` — DESLIGADA por
 * padrão: sem `enabled === true`, nada pede permissão e nada disca.
 */
export interface VoiceCallSettings {
  enabled: boolean;
  /** Horas depois do envio da cotação sem resposta do cliente. */
  delayHours: number;
}

export const DEFAULT_DELAY_HOURS = 24;
const MAX_DELAY_HOURS = 168;
/** Pede permissão só logo depois da cotação (a janela costuma estar aberta). */
export const PERMISSION_REQUEST_MAX_AGE_MIN = 60;
/** Depois do prazo, ainda tenta por mais este tempo (expediente, fila); passou disso, desiste. */
export const CALL_GRACE_HOURS = 48;

const HOUR = 3600_000;

export function parseVoiceCallSettings(settings: unknown): VoiceCallSettings {
  const raw =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>).voiceCalls
      : undefined;
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const delay = obj.delayHours;
  const delayHours =
    typeof delay === 'number' && Number.isInteger(delay) && delay >= 1 && delay <= MAX_DELAY_HOURS ? delay : DEFAULT_DELAY_HOURS;
  return { enabled: obj.enabled === true, delayHours };
}

export type PermissionDecision = { action: 'PEDIR' } | { action: 'PULAR'; reason: 'JANELA_FECHADA' | 'JA_PEDIDO' | 'NAO_LIGAR' | 'COTACAO_ANTIGA' };

export function decidePermissionRequest(input: {
  now: Date;
  proposalCreatedAt: Date;
  windowOpen: boolean;
  alreadyRequested: boolean;
  optedOut: boolean;
}): PermissionDecision {
  if (input.alreadyRequested) return { action: 'PULAR', reason: 'JA_PEDIDO' };
  if (input.optedOut) return { action: 'PULAR', reason: 'NAO_LIGAR' };
  if (input.now.getTime() - input.proposalCreatedAt.getTime() > PERMISSION_REQUEST_MAX_AGE_MIN * 60_000) {
    return { action: 'PULAR', reason: 'COTACAO_ANTIGA' };
  }
  if (!input.windowOpen) return { action: 'PULAR', reason: 'JANELA_FECHADA' };
  return { action: 'PEDIR' };
}

export type CallDecision =
  | { action: 'LIGAR' }
  | { action: 'ESPERAR'; reason: 'ANTES_DO_PRAZO' | 'FORA_DO_EXPEDIENTE' }
  | { action: 'PULAR'; reason: 'CLIENTE_RESPONDEU' | 'SEM_VENDEDOR' | 'NAO_LIGAR' | 'JA_LIGOU' | 'PASSOU_DO_PRAZO' };

export function decideCall(input: {
  now: Date;
  delayHours: number;
  proposalCreatedAt: Date;
  lastInboundAt: Date | null;
  hasOwner: boolean;
  withinHours: boolean;
  optedOut: boolean;
  alreadyCalled: boolean;
}): CallDecision {
  if (input.alreadyCalled) return { action: 'PULAR', reason: 'JA_LIGOU' };
  if (input.optedOut) return { action: 'PULAR', reason: 'NAO_LIGAR' };
  if (input.lastInboundAt && input.lastInboundAt.getTime() > input.proposalCreatedAt.getTime()) {
    return { action: 'PULAR', reason: 'CLIENTE_RESPONDEU' };
  }
  if (!input.hasOwner) return { action: 'PULAR', reason: 'SEM_VENDEDOR' };
  const age = input.now.getTime() - input.proposalCreatedAt.getTime();
  if (age < input.delayHours * HOUR) return { action: 'ESPERAR', reason: 'ANTES_DO_PRAZO' };
  if (age > (input.delayHours + CALL_GRACE_HOURS) * HOUR) return { action: 'PULAR', reason: 'PASSOU_DO_PRAZO' };
  if (!input.withinHours) return { action: 'ESPERAR', reason: 'FORA_DO_EXPEDIENTE' };
  return { action: 'LIGAR' };
}
