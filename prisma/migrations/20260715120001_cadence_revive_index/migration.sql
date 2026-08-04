-- Índice separado da migração anterior de propósito: o label 'PAUSED' é criado
-- lá pelo ALTER TYPE, e o Postgres proíbe referenciá-lo na mesma transação
-- (P3009). Aqui ele já existe e commitou, então a comparação direta com o enum
-- funciona — e, ao contrário de `status::text`, ela é IMMUTABLE, que é o que o
-- índice parcial exige (42P17).
--
-- IF NOT EXISTS porque em produção este índice já foi criado à mão em 20/07,
-- quando a migração original falhou.
DROP INDEX IF EXISTS "uq_active_enrollment_per_conversation";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_active_enrollment_per_conversation"
  ON "cadence_enrollments"("conversation_id")
  WHERE status IN ('ACTIVE', 'PAUSED');
