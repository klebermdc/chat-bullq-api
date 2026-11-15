-- Modelos de contrato (document_templates) e contrato via link de aceite.
-- O texto dos modelos é material licenciado: entra por org via
-- scripts/import-document-templates.ts, nunca por esta migração.

-- CreateEnum
CREATE TYPE "AcceptanceKind" AS ENUM ('DELIVERY', 'CONTRACT');

-- CreateEnum
CREATE TYPE "DocumentTemplateAudience" AS ENUM ('CLIENT', 'INTERNAL');

-- AlterTable: aceites existentes viram DELIVERY pelo default.
ALTER TABLE "order_acceptances"
    ADD COLUMN "kind" "AcceptanceKind" NOT NULL DEFAULT 'DELIVERY',
    ADD COLUMN "title" TEXT,
    ADD COLUMN "template_id" TEXT;

-- CreateTable
CREATE TABLE "document_templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "audience" "DocumentTemplateAudience" NOT NULL,
    "body" TEXT NOT NULL,
    "source_ref" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_organization_id_source_ref_key" ON "document_templates"("organization_id", "source_ref");

-- CreateIndex
CREATE INDEX "document_templates_organization_id_audience_is_active_idx" ON "document_templates"("organization_id", "audience", "is_active");

-- CreateIndex
CREATE INDEX "order_acceptances_organization_id_conversation_id_kind_idx" ON "order_acceptances"("organization_id", "conversation_id", "kind");

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
