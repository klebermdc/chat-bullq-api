-- Mensagem rápida por vendedor. Nulo = da equipe inteira; preenchido = só o
-- vendedor (e dono/admin da organização) enxerga.
ALTER TABLE "quick_replies" ADD COLUMN IF NOT EXISTS "owner_user_id" TEXT;

CREATE INDEX IF NOT EXISTS "quick_replies_organization_id_owner_user_id_idx"
  ON "quick_replies"("organization_id", "owner_user_id");

ALTER TABLE "quick_replies" DROP CONSTRAINT IF EXISTS "quick_replies_owner_user_id_fkey";
ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
