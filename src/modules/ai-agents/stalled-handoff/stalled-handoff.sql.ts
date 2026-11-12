import { Prisma } from '@prisma/client';

/** Horas de silêncio do cliente depois da última fala da IA. */
export const STALL_HOURS = 3;
/** Mais velho que isso já não vale puxar: o lead esfriou e a janela fechou. */
export const STALL_MAX_AGE_HOURS = 72;
/** Mínimo de mensagens do cliente: só quem de fato conversou com a IA. */
export const STALL_MIN_INBOUND = 2;
/** Teto por rodada, para uma rodada nunca inundar a fila. */
export const STALL_BATCH_LIMIT = 50;

export interface StalledConversationRow {
  conversation_id: string;
  organization_id: string;
  contact_id: string;
  channel_id: string;
  agent_id: string;
  run_id: string;
}

/**
 * Leads que pararam no meio da qualificação sem a IA transferir.
 *
 * Regras:
 * - só orgs em modo SDR (`ai_security_rules.blockCommercialTalk = true`): ali a
 *   IA só qualifica e o fim normal é a transferência;
 * - conversa aberta, sem dono, não arquivada, IA não desligada à mão;
 * - a última mensagem é da IA (metadata com aiAgentId e runId) e tem entre
 *   STALL_HOURS e STALL_MAX_AGE_HOURS;
 * - o cliente mandou pelo menos STALL_MIN_INBOUND mensagens;
 * - nunca houve transferToHuman na conversa (pendente, aprovada ou rejeitada):
 *   se um humano já decidiu, o vigia não refaz.
 */
export function buildStalledHandoffQuery(): Prisma.Sql {
  return Prisma.sql`
    SELECT c.id AS conversation_id,
           c.organization_id,
           c.contact_id,
           c.channel_id,
           r.agent_id,
           r.id AS run_id
    FROM conversations c
    JOIN organizations o ON o.id = c.organization_id
    JOIN LATERAL (
      SELECT m.direction::text AS direction, m.metadata, m.created_at
      FROM messages m
      WHERE m.conversation_id = c.id
      ORDER BY m.created_at DESC
      LIMIT 1
    ) ultima ON true
    JOIN ai_agent_runs r ON r.id = ultima.metadata->>'runId'
    WHERE o.deleted_at IS NULL
      AND o.ai_security_rules->>'blockCommercialTalk' = 'true'
      AND c.deleted_at IS NULL
      AND c.is_archived = false
      AND c.status <> 'CLOSED'
      AND c.assigned_to_id IS NULL
      AND c.ai_enabled IS DISTINCT FROM false
      AND ultima.direction = 'OUTBOUND'
      AND ultima.metadata ? 'aiAgentId'
      AND ultima.created_at < (now() AT TIME ZONE 'utc') - make_interval(hours => ${STALL_HOURS})
      AND ultima.created_at > (now() AT TIME ZONE 'utc') - make_interval(hours => ${STALL_MAX_AGE_HOURS})
      AND (
        SELECT count(*) FROM messages i
        WHERE i.conversation_id = c.id AND i.direction = 'INBOUND'
      ) >= ${STALL_MIN_INBOUND}
      AND NOT EXISTS (
        SELECT 1 FROM ai_pending_actions p
        WHERE p.conversation_id = c.id AND p.tool_name = 'transferToHuman'
      )
    ORDER BY ultima.created_at
    LIMIT ${STALL_BATCH_LIMIT}
  `;
}
