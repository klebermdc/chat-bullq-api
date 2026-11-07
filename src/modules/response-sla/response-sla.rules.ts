import { ConversationStatus, OrgRole } from '@prisma/client';
import type { BusinessHoursConfig } from '../routing/availability/business-hours.util';
import { addBusinessMinutes } from '../routing/availability/business-minutes.util';

/**
 * Regras puras do SLA de resposta em horário útil (sem banco nem fila).
 *
 * Decisões do dono do produto:
 * - meta em `organizations.settings.responseSlaMinutes` (opt-in por org);
 * - conta só no expediente do dono da conversa; sem dono ou dono sem horário
 *   → horário da org; nenhum dos dois → 24/7;
 * - aviso na metade da meta (só o dono), estouro na meta (dono + ADM/Owner
 *   online; sem dono, todos os online).
 */

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
/** Fração da meta em que sai o aviso "cliente esperando". */
export const WARN_FRACTION = 0.5;

export type SlaStage = 'warn' | 'breach';

export interface StagePlan {
  warnAt: Date | null;
  dueAt: Date | null;
}

/** Meta em minutos; null = recurso desligado na org (ausente ou inválido). */
export function parseResponseSlaMinutes(settings: unknown): number | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return null;
  }
  const value = (settings as Record<string, unknown>).responseSlaMinutes;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return null;
  }
  return Math.floor(value);
}

/** JSON do banco → agenda; qualquer coisa que não seja objeto vira null. */
export function toHoursConfig(json: unknown): BusinessHoursConfig | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  return json as BusinessHoursConfig;
}

/** Horário do atendente, senão o da org; null = 24/7. */
export function resolveHours(
  agentHours: BusinessHoursConfig | null,
  orgHours: BusinessHoursConfig | null,
): BusinessHoursConfig | null {
  return agentHours ?? orgHours ?? null;
}

/** Cliente aguardando humano: aba "Esperando" (mesma regra do countByTab). */
export function isWaitingForHuman(c: {
  awaitingHumanReply: boolean;
  status: ConversationStatus;
  deletedAt: Date | null;
  isArchived: boolean;
}): boolean {
  return (
    c.awaitingHumanReply &&
    c.status !== ConversationStatus.CLOSED &&
    !c.deletedAt &&
    !c.isArchived
  );
}

/**
 * A IA (Aline) está conduzindo — o relógio não começa. O flag
 * `awaitingHumanReply` liga em TODA mensagem do cliente, inclusive enquanto a
 * Aline atende; por isso a decisão do roteador da IA entra aqui.
 * Plantão (vendedor fora do horário, Aline cobrindo) não conta como IA no
 * comando: a conversa segue sendo do vendedor.
 */
export function isAiInCharge(
  conversation: { aiUntilHandoff: boolean },
  decision: { handle: boolean; onCall?: unknown },
): boolean {
  if (conversation.aiUntilHandoff) return true;
  return decision.handle && !decision.onCall;
}

export function planStages(
  hours: BusinessHoursConfig | null,
  tz: string,
  waitingSince: Date,
  slaMinutes: number,
): StagePlan {
  return {
    warnAt: addBusinessMinutes(hours, tz, waitingSince, slaMinutes * WARN_FRACTION),
    dueAt: addBusinessMinutes(hours, tz, waitingSince, slaMinutes),
  };
}

/**
 * Id determinístico do job: mesma espera + etapa + alvo = mesmo job (o BullMQ
 * ignora o duplicado). Alvo novo (troca de dono) gera job novo; o antigo, ao
 * disparar, recalcula e vira no-op.
 */
export function stageJobId(
  conversationId: string,
  waitingSince: Date,
  stage: SlaStage,
  at: Date,
): string {
  return `rsla-${conversationId}-${waitingSince.getTime()}-${stage}-${at.getTime()}`;
}

const MANAGER_ROLES: ReadonlySet<OrgRole> = new Set([OrgRole.ADMIN, OrgRole.OWNER]);

/**
 * Quem recebe o estouro. Com dono: o dono (mesmo offline — o sino guarda) e
 * ADM/Owner online. Sem dono: todos os online. Sem repetição.
 */
export function pickBreachRecipients(
  ownerId: string | null,
  online: ReadonlyArray<{ userId: string; role: OrgRole }>,
): string[] {
  const candidates = ownerId
    ? [ownerId, ...online.filter((m) => MANAGER_ROLES.has(m.role)).map((m) => m.userId)]
    : online.map((m) => m.userId);
  return [...new Set(candidates)];
}
