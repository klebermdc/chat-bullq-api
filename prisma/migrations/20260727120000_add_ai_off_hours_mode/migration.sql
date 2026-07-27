-- Modo da IA fora do horário comercial (`aiBusinessHours`).
-- SILENT (default) = não responde; MESSAGE = envia `aiOutOfHoursMessage` 1x
-- por período fechado; ATTEND = atende 24/7 e avisa o horário.
-- Aditivo puro (ADD COLUMN NOT NULL DEFAULT / NULLABLE) → seguro para migrate deploy no boot.

ALTER TABLE "organizations"
  ADD COLUMN "ai_off_hours_mode" TEXT NOT NULL DEFAULT 'SILENT';

-- Dedup do modo MESSAGE: quando o texto fixo já foi enviado nesta conversa.
ALTER TABLE "conversations"
  ADD COLUMN "ai_off_hours_message_at" TIMESTAMP(3);
