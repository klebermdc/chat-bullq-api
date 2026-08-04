-- Estado PAUSED: resposta fraca do cliente pausa (não encerra) a cadência.
ALTER TYPE "CadenceEnrollmentStatus" ADD VALUE IF NOT EXISTS 'PAUSED';

-- Config da cadência (ajustável sem deploy).
ALTER TABLE "cadences"
  ADD COLUMN "revive_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "silence_window_minutes" INTEGER NOT NULL DEFAULT 1440;

-- Auditoria do pause.
ALTER TABLE "cadence_enrollments"
  ADD COLUMN "paused_at" TIMESTAMP(3);

-- O índice parcial que cobre ACTIVE+PAUSED foi movido para a migração
-- seguinte (20260715120001_cadence_revive_index): o Postgres proíbe usar um
-- label de enum na mesma transação em que ele é criado (P3009), e a
-- alternativa com `status::text` esbarra em outro limite (42P17 — cast
-- enum→text é STABLE, não IMMUTABLE, e índice parcial exige predicado
-- imutável). Por isso o índice precisa de transação própria.
