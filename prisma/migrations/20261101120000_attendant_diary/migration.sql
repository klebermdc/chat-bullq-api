-- Diário do atendente: tabela nova, sem tocar em dados existentes.

CREATE TABLE IF NOT EXISTS "attendant_diaries" (
  "id"                     TEXT NOT NULL,
  "organization_id"        TEXT NOT NULL,
  "user_id"                TEXT NOT NULL,
  "day"                    DATE NOT NULL,
  "status"                 TEXT NOT NULL,
  "metrics"                JSONB NOT NULL DEFAULT '{}',
  "summary"                TEXT,
  "strengths"              JSONB NOT NULL DEFAULT '[]',
  "improvements"           JSONB NOT NULL DEFAULT '[]',
  "conversations_analyzed" INTEGER NOT NULL DEFAULT 0,
  "discarded_points"       INTEGER NOT NULL DEFAULT 0,
  "criteria_versions"      JSONB NOT NULL DEFAULT '{}',
  "model_id"               TEXT,
  "cost_usd"               DOUBLE PRECISION NOT NULL DEFAULT 0,
  "error_message"          TEXT,
  "viewed_at"              TIMESTAMP(3),
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendant_diaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "attendant_diaries_organization_id_user_id_day_key"
  ON "attendant_diaries" ("organization_id", "user_id", "day");

CREATE INDEX IF NOT EXISTS "idx_diary_org_day"
  ON "attendant_diaries" ("organization_id", "day");
