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
--
-- `status::text` NÃO é firula: o Postgres proíbe *usar* um label de enum na
-- mesma transação em que ele foi criado pelo ADD VALUE lá em cima, e o Prisma
-- roda cada migração numa transação só. Escrito como `status IN ('ACTIVE',
-- 'PAUSED')` os literais resolvem contra o enum, batem no label recém-criado e
-- a migração morre com P3009 — foi assim que a prod caiu em 20/07. Comparando
-- `status::text` com literais de texto, o label novo nunca é referenciado e a
-- restrição some. A unicidade é idêntica (o cast enum→text é imutável, então
-- serve de predicado de índice).
DROP INDEX IF EXISTS "uq_active_enrollment_per_conversation";
CREATE UNIQUE INDEX "uq_active_enrollment_per_conversation"
  ON "cadence_enrollments"("conversation_id")
  WHERE status::text IN ('ACTIVE', 'PAUSED');
