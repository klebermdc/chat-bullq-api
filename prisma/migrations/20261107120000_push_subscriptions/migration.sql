-- Web Push do vendedor. A tabela existe desde 20260327022449_update, mas nada
-- no código gravava nela: as linhas que houver não têm organização e não
-- servem para envio. Saem antes de a coluna virar obrigatória.

DELETE FROM "push_subscriptions";

ALTER TABLE "push_subscriptions"
  ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "idx_push_sub_user_org"
  ON "push_subscriptions" ("user_id", "organization_id");

ALTER TABLE "push_subscriptions"
  ADD CONSTRAINT "push_subscriptions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
