-- Chamado de suporte: número curto por organização (#S-0042) nos cards do
-- quadro "Suporte". Coluna nova e opcional; os outros cards ficam nulos.

ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "ticket_number" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "cards_organization_id_ticket_number_key"
  ON "cards" ("organization_id", "ticket_number");
