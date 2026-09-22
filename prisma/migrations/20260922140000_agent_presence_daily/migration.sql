-- Painel "Equipe agora": tempo online e ativo de cada atendente por dia.
-- Uma linha por (org, atendente, dia no fuso da org), somada a cada minuto
-- pelo PresenceSamplerService.
CREATE TABLE IF NOT EXISTS "agent_presence_daily" (
  "organization_id" TEXT NOT NULL,
  "user_id"         TEXT NOT NULL,
  "day"             DATE NOT NULL,
  "online_minutes"  INTEGER NOT NULL DEFAULT 0,
  "active_minutes"  INTEGER NOT NULL DEFAULT 0,
  "first_seen_at"   TIMESTAMP(3) NOT NULL,
  "last_seen_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_presence_daily_pkey" PRIMARY KEY ("organization_id", "user_id", "day")
);

CREATE INDEX IF NOT EXISTS "agent_presence_daily_organization_id_day_idx"
  ON "agent_presence_daily" ("organization_id", "day");
