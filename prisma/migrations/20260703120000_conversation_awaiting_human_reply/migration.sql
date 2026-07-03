-- AlterTable: sinal das abas de atendimento (Esperando / Caixa de entrada)
ALTER TABLE "conversations"
  ADD COLUMN "awaiting_human_reply" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex: fila por aba (status + awaiting) escopada por org
CREATE INDEX "idx_conv_org_status_awaiting"
  ON "conversations"("organization_id", "status", "awaiting_human_reply");

-- Backfill: conversas NÃO fechadas cuja última mensagem é do cliente (INBOUND)
-- começam em "Esperando". As demais (última msg nossa, ou sem mensagens) ficam
-- em "Caixa de entrada" (default false). Fechadas vão pra "Finalizados" via status.
-- Subquery sem mensagens retorna NULL → `NULL = 'INBOUND'` não é true → fica false.
UPDATE "conversations" c
SET "awaiting_human_reply" = true
WHERE c."status" <> 'CLOSED'
  AND (
    SELECT m."direction"
    FROM "messages" m
    WHERE m."conversation_id" = c."id"
    ORDER BY m."created_at" DESC
    LIMIT 1
  ) = 'INBOUND';
