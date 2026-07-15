-- Estado PAUSED: resposta fraca do cliente pausa (não encerra) a cadência.
ALTER TYPE "CadenceEnrollmentStatus" ADD VALUE IF NOT EXISTS 'PAUSED';

-- Config da cadência (ajustável sem deploy).
ALTER TABLE "cadences"
  ADD COLUMN "revive_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "silence_window_minutes" INTEGER NOT NULL DEFAULT 1440;

-- Auditoria do pause.
ALTER TABLE "cadence_enrollments"
  ADD COLUMN "paused_at" TIMESTAMP(3);

-- Um enrollment PAUSED ainda "ocupa" a conversa: reentrar na etapa não pode
-- criar um segundo enrollment. Índice parcial passa a cobrir ACTIVE e PAUSED.
DROP INDEX IF EXISTS "uq_active_enrollment_per_conversation";
CREATE UNIQUE INDEX "uq_active_enrollment_per_conversation"
  ON "cadence_enrollments"("conversation_id")
  WHERE status IN ('ACTIVE', 'PAUSED');
