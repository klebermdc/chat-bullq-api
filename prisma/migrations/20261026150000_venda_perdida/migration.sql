-- Venda perdida: motivo registrado pelo vendedor ao encerrar a conversa sem
-- venda. Só colunas novas e nulas — nada muda nas conversas existentes.

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "lost_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "lost_note"   TEXT,
  ADD COLUMN IF NOT EXISTS "lost_at"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lost_by_id"  TEXT;

-- Relatório de perdas por período.
CREATE INDEX IF NOT EXISTS "idx_conv_org_lost_at"
  ON "conversations" ("organization_id", "lost_at");
