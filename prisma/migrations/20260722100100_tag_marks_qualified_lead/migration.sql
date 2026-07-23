-- Marca quais tags representam "lead qualificado". Aditiva: default false,
-- então nenhuma tag existente passa a disparar o evento sem ação explícita.
ALTER TABLE "tags"
  ADD COLUMN IF NOT EXISTS "marks_qualified_lead" BOOLEAN NOT NULL DEFAULT false;
