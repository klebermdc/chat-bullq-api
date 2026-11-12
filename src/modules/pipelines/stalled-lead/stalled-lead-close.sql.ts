import { Prisma } from '@prisma/client';
import { STALL_MIN_INBOUND } from '../../ai-agents/stalled-handoff/stalled-handoff.sql';

/** Horas sem resposta do cliente depois da última fala da IA. */
export const NO_REPLY_CLOSE_HOURS = 48;
/** Teto por rodada. */
export const NO_REPLY_BATCH_LIMIT = 50;

export interface NoReplyConversationRow {
  conversation_id: string;
  organization_id: string;
  owner_id: string;
}

/**
 * Leads que pouco conversaram com a IA (menos de STALL_MIN_INBOUND mensagens)
 * e não respondem há NO_REPLY_CLOSE_HOURS. Viram venda perdida "Não respondeu"
 * para não encher a fila de distribuição, que fica só com quem conversou
 * (esses vão à fila pelo StalledHandoffService).
 *
 * - só orgs em modo SDR (`ai_security_rules.blockCommercialTalk = true`);
 * - conversa aberta, sem dono, não arquivada, IA não desligada à mão;
 * - a última mensagem é da IA;
 * - nunca houve transferToHuman (lead na fila rosa nunca é fechado aqui);
 * - sem mensagem agendada nem cadência viva: elas ainda vão falar com o cliente;
 * - o ator é o OWNER mais antigo da org (venda perdida pede um usuário).
 */
export function buildNoReplyCloseQuery(): Prisma.Sql {
  return Prisma.sql`
    SELECT c.id AS conversation_id,
           c.organization_id,
           dono.user_id AS owner_id
    FROM conversations c
    JOIN organizations o ON o.id = c.organization_id
    JOIN LATERAL (
      SELECT u.user_id FROM user_organizations u
      WHERE u.organization_id = c.organization_id AND u.role = 'OWNER'
      ORDER BY u.joined_at
      LIMIT 1
    ) dono ON true
    JOIN LATERAL (
      SELECT m.direction::text AS direction, m.metadata, m.created_at
      FROM messages m
      WHERE m.conversation_id = c.id
      ORDER BY m.created_at DESC
      LIMIT 1
    ) ultima ON true
    WHERE o.deleted_at IS NULL
      AND o.ai_security_rules->>'blockCommercialTalk' = 'true'
      AND c.deleted_at IS NULL
      AND c.is_archived = false
      AND c.status <> 'CLOSED'
      AND c.assigned_to_id IS NULL
      AND c.ai_enabled IS DISTINCT FROM false
      AND ultima.direction = 'OUTBOUND'
      AND ultima.metadata ? 'aiAgentId'
      AND ultima.created_at < (now() AT TIME ZONE 'utc') - make_interval(hours => ${NO_REPLY_CLOSE_HOURS})
      AND (
        SELECT count(*) FROM messages i
        WHERE i.conversation_id = c.id AND i.direction = 'INBOUND'
      ) < ${STALL_MIN_INBOUND}
      AND NOT EXISTS (
        SELECT 1 FROM ai_pending_actions p
        WHERE p.conversation_id = c.id AND p.tool_name = 'transferToHuman'
      )
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_messages s
        WHERE s.conversation_id = c.id AND s.status IN ('PENDING', 'SENDING')
      )
      AND NOT EXISTS (
        SELECT 1 FROM cadence_enrollments e
        WHERE e.conversation_id = c.id AND e.status IN ('ACTIVE', 'PAUSED')
      )
    ORDER BY ultima.created_at
    LIMIT ${NO_REPLY_BATCH_LIMIT}
  `;
}
