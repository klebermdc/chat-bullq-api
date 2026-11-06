-- Travas de saída da IA (guardrails): tabela nova, sem tocar em dados existentes.
-- "check_kind" e não "check": CHECK é palavra reservada do Postgres.

CREATE TABLE IF NOT EXISTS "ai_send_checks" (
  "id"              TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "run_id"          TEXT NOT NULL,
  "agent_id"        TEXT NOT NULL,
  "check_kind"      TEXT NOT NULL,
  "verdict"         TEXT NOT NULL,
  "sentence"        TEXT,
  "scores"          JSONB,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_send_checks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_send_check_org_time"
  ON "ai_send_checks" ("organization_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_send_check_run"
  ON "ai_send_checks" ("run_id");
