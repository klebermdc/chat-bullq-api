import { Prisma } from '@prisma/client';

/** Marca no audit log que distingue o fechamento automático do manual. */
export const AUTO_CLOSE_TRIGGER = 'auto_close_inactive';

/**
 * Fecha, numa única instrução, as conversas paradas além do prazo da org.
 *
 * Regras (todas no SQL, para o fechamento e o audit log saírem juntos):
 * - só orgs com `settings.autoCloseInactiveDays` numérico >= 1 (opt-in);
 * - parada = sem mensagem (`last_message_at`, ou `created_at` se nunca houve)
 *   há mais que o prazo;
 * - fica de fora quem tem mensagem agendada viva (PENDING/SENDING) ou
 *   cadência viva (ACTIVE/PAUSED): o vendedor ou a cadência ainda vão falar.
 *
 * Deliberadamente NÃO passa pelo `ConversationFsmService.transition`: aquele
 * caminho pede avaliação ao cliente e enfileira CONVERSATION_STATUS_CHANGED
 * (automações, funil de venda perdida). Fechar por inatividade não é o fim de
 * um atendimento, então não deve mandar nada ao cliente.
 *
 * `FOR UPDATE SKIP LOCKED` evita brigar com uma conversa que está recebendo
 * mensagem neste instante; ela fica para a próxima rodada.
 */
export function buildAutoCloseQuery(): Prisma.Sql {
  return Prisma.sql`
    WITH alvo AS (
      SELECT c.id, c.status::text AS from_status,
             (o.settings->>'autoCloseInactiveDays')::numeric::int AS dias
      FROM conversations c
      JOIN organizations o ON o.id = c.organization_id
      WHERE jsonb_typeof(o.settings->'autoCloseInactiveDays') = 'number'
        AND (o.settings->>'autoCloseInactiveDays')::numeric >= 1
        AND c.deleted_at IS NULL
        AND c.is_archived = false
        AND c.status <> 'CLOSED'
        AND coalesce(c.last_message_at, c.created_at)
            < (now() AT TIME ZONE 'utc')
              - make_interval(days => (o.settings->>'autoCloseInactiveDays')::numeric::int)
        AND NOT EXISTS (
          SELECT 1 FROM scheduled_messages s
          WHERE s.conversation_id = c.id AND s.status IN ('PENDING', 'SENDING')
        )
        AND NOT EXISTS (
          SELECT 1 FROM cadence_enrollments e
          WHERE e.conversation_id = c.id AND e.status IN ('ACTIVE', 'PAUSED')
        )
      FOR UPDATE OF c SKIP LOCKED
    ),
    fechadas AS (
      UPDATE conversations c
      SET status = 'CLOSED',
          closed_at = now() AT TIME ZONE 'utc',
          awaiting_human_reply = false,
          updated_at = now() AT TIME ZONE 'utc'
      FROM alvo
      WHERE c.id = alvo.id
      RETURNING c.id, alvo.from_status, alvo.dias
    )
    INSERT INTO conversation_audit_logs
      (id, conversation_id, actor_id, action, from_value, to_value, metadata, created_at)
    SELECT gen_random_uuid()::text, f.id, NULL, 'STATUS_CHANGED', f.from_status, 'CLOSED',
           jsonb_build_object('trigger', ${AUTO_CLOSE_TRIGGER}::text, 'inactiveDays', f.dias),
           now() AT TIME ZONE 'utc'
    FROM fechadas f
    RETURNING conversation_id
  `;
}
