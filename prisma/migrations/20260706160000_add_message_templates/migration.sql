-- Message Templates (WhatsApp Cloud API / HSM). Aditivo: tabela nova + índices + FKs.
-- Sem mudança destrutiva em tabelas existentes.

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "category" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'pt_BR',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "components" JSONB NOT NULL,
    "variable_examples" JSONB NOT NULL DEFAULT '{}',
    "meta_template_id" TEXT,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_meta_template_id_key" ON "message_templates"("meta_template_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_channel_id_name_key" ON "message_templates"("channel_id", "name");

-- CreateIndex
CREATE INDEX "message_templates_organization_id_status_idx" ON "message_templates"("organization_id", "status");

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
