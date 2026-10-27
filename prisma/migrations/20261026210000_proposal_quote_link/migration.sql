-- Cotação por link (kind = 'QUOTE'): token da página pública, validade e
-- contagem de aberturas pelo cliente. Só colunas novas, nulas ou com default —
-- nada muda nas propostas existentes.

ALTER TABLE "proposals"
  ADD COLUMN IF NOT EXISTS "public_token"    TEXT,
  ADD COLUMN IF NOT EXISTS "expires_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "view_count"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "first_viewed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_viewed_at"  TIMESTAMP(3);

-- O token é o único fator de acesso à página pública.
CREATE UNIQUE INDEX IF NOT EXISTS "proposals_public_token_key"
  ON "proposals" ("public_token");
