-- Cotação por link: número por organização, versão atual e data da última
-- atualização; as versões anteriores vão para proposal_versions. Só colunas
-- novas — nada muda nas propostas que não são QUOTE.

ALTER TABLE "proposals"
  ADD COLUMN IF NOT EXISTS "quote_number"     INTEGER,
  ADD COLUMN IF NOT EXISTS "quote_version"    INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "quote_updated_at" TIMESTAMP(3);

-- Cotações que já existem ganham número pela ordem de criação.
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "organization_id" ORDER BY "created_at", "id") AS n
  FROM "proposals"
  WHERE "kind" = 'QUOTE' AND "quote_number" IS NULL
)
UPDATE "proposals" p SET "quote_number" = numbered.n FROM numbered WHERE p."id" = numbered."id";

CREATE UNIQUE INDEX IF NOT EXISTS "proposals_org_quote_number_key"
  ON "proposals" ("organization_id", "quote_number");

CREATE TABLE IF NOT EXISTS "proposal_versions" (
  "id"             TEXT          NOT NULL,
  "proposal_id"    TEXT          NOT NULL,
  "version"        INTEGER       NOT NULL,
  "details"        JSONB         NOT NULL,
  "total_value"    DECIMAL(12,2) NOT NULL,
  "expires_at"     TIMESTAMP(3),
  "replaced_by_id" TEXT          NOT NULL,
  "replaced_at"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proposal_versions_proposal_id_fkey" FOREIGN KEY ("proposal_id")
    REFERENCES "proposals" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "proposal_versions_proposal_id_version_key"
  ON "proposal_versions" ("proposal_id", "version");
