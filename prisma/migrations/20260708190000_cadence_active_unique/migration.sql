-- FIX 3: impede corrida de enrollments ativos duplicados por conversa.
-- Prisma não expressa unique parcial no schema; índice criado via SQL cru.
CREATE UNIQUE INDEX "uq_active_enrollment_per_conversation"
  ON "cadence_enrollments"("conversation_id")
  WHERE status = 'ACTIVE';
