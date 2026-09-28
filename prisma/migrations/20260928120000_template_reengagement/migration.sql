-- Template de retomada: o ícone do chat abre este template já escolhido para
-- reabrir a conversa depois que a janela de 24h fecha. Um por canal.
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "is_reengagement" BOOLEAN NOT NULL DEFAULT false;

-- Garante "um por canal" no banco: dois cliques simultâneos em templates
-- diferentes não deixam o canal com duas retomadas marcadas.
CREATE UNIQUE INDEX IF NOT EXISTS "message_templates_one_reengagement_per_channel"
  ON "message_templates" ("channel_id") WHERE "is_reengagement";
