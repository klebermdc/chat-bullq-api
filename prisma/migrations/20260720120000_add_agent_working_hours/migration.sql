-- Agenda por atendente
ALTER TABLE "user_organizations" ADD COLUMN "working_hours" JSONB;
ALTER TABLE "user_organizations" ADD COLUMN "off_hours_notice_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Template do aviso (org-level)
ALTER TABLE "organizations" ADD COLUMN "off_hours_message_template" TEXT;

-- Dedup "1x por período" na conversa
ALTER TABLE "conversations" ADD COLUMN "off_hours_notice_at" TIMESTAMP(3);
