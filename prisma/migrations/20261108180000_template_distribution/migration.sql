-- Template de distribuição: sai sozinho quando um lead é distribuído/transferido
-- e a janela de 24h já fechou ({{1}} = cliente, {{2}} = vendedor). Um por canal.
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "is_distribution" BOOLEAN NOT NULL DEFAULT false;

-- "Um por canal" garantido no banco, igual ao de retomada.
CREATE UNIQUE INDEX IF NOT EXISTS "message_templates_one_distribution_per_channel"
  ON "message_templates" ("channel_id") WHERE "is_distribution";
