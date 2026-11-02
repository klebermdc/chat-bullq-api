-- Diário mais completo: foco, notas, conversas, treino e pendências em JSON.
ALTER TABLE "attendant_diaries" ADD COLUMN IF NOT EXISTS "details" JSONB NOT NULL DEFAULT '{}';
