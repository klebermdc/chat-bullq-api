-- Etapa "ao esgotar o reengajamento" (Motor A / Inatividade). Quando o burst
-- AUTO_REENGAGE esgota sem resposta, o card é movido/criado nesta etapa
-- (ex.: "Não respondeu"). null = não mexe no pipeline. Aditivo puro.

ALTER TABLE "inactivity_settings"
  ADD COLUMN "exhausted_stage_id" TEXT;

ALTER TABLE "scheduled_messages"
  ADD COLUMN "exhausted_stage_id" TEXT;
