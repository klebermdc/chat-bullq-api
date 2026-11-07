-- Leads do site: configuração por org, histórico de envios e a flag da IA
-- ligada pela automação. Só acrescenta; nenhum dado existente muda.

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "ai_until_handoff" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "meta_capi_configs"
  ADD COLUMN IF NOT EXISTS "page_id" TEXT;

CREATE TABLE IF NOT EXISTS "website_lead_settings" (
  "organization_id"  TEXT NOT NULL,
  "enabled"          BOOLEAN NOT NULL DEFAULT false,
  "channel_id"       TEXT,
  "template_id"      TEXT,
  "delay_minutes"    INTEGER NOT NULL DEFAULT 5,
  "token_hash"       TEXT,
  "token_preview"    TEXT,
  "token_created_at" TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "website_lead_settings_pkey" PRIMARY KEY ("organization_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "website_lead_settings_token_hash_key"
  ON "website_lead_settings" ("token_hash");

CREATE TABLE IF NOT EXISTS "lead_submissions" (
  "id"                       TEXT NOT NULL,
  "organization_id"          TEXT NOT NULL,
  "contact_id"               TEXT NOT NULL,
  "form_kind"                TEXT NOT NULL,
  "form_id"                  TEXT,
  "form_name"                TEXT,
  "dedupe_key"               TEXT NOT NULL,
  "phone"                    TEXT NOT NULL,
  "raw"                      JSONB NOT NULL DEFAULT '{}',
  "attribution"              JSONB NOT NULL DEFAULT '{}',
  "followup_status"          TEXT NOT NULL DEFAULT 'PENDING',
  "followup_reason"          TEXT,
  "followup_scheduled_at"    TIMESTAMP(3),
  "followup_sent_at"         TIMESTAMP(3),
  "followup_conversation_id" TEXT,
  "followup_message_id"      TEXT,
  "followup_template_name"   TEXT,
  "followup_category"        TEXT,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lead_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_lead_sub_org_time"
  ON "lead_submissions" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_lead_sub_contact_time"
  ON "lead_submissions" ("contact_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_lead_sub_dedupe"
  ON "lead_submissions" ("organization_id", "dedupe_key");
