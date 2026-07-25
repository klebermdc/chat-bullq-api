-- Reengajamento só para leads "parados na IA" (fase Aline).
-- Aditivo puro (NOT NULL DEFAULT false) → seguro para migrate deploy no boot.

ALTER TABLE "inactivity_settings"
  ADD COLUMN "reengage_only_ai_parked" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "scheduled_messages"
  ADD COLUMN "require_ai_parked" BOOLEAN NOT NULL DEFAULT false;
