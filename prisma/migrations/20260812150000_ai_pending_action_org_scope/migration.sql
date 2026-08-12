-- `ai_pending_actions` não tinha dona, então `GET /pending-actions` devolvia as
-- pendências de TODAS as empresas para qualquer usuário autenticado, e
-- approve/reject/distribute alcançavam a conversa de outra empresa pelo id.

-- 1) Coluna nullable. NOT NULL exigiria apagar linha órfã (conversa já
--    deletada; não há FK), e apagar dado de produção numa migração de
--    segurança é troca ruim: com o filtro por igualdade, órfã com NULL nunca
--    casa com organização nenhuma e some das listagens — fail-closed.
ALTER TABLE "ai_pending_actions" ADD COLUMN "organization_id" TEXT;

-- 2) Backfill pela conversa, que é quem sempre teve a organização.
UPDATE "ai_pending_actions" p
SET "organization_id" = c."organization_id"
FROM "conversations" c
WHERE c."id" = p."conversation_id";

-- 3) Índice do caminho quente: listagem de pendências da org por status.
CREATE INDEX "idx_ai_pending_org_status_time"
  ON "ai_pending_actions" ("organization_id", "status", "created_at" DESC);
