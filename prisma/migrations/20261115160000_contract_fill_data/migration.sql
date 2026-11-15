-- Preenchimento de contrato: dados fixos da agência por org e dados pessoais
-- do cliente lembrados por contato (tabela à parte, fora das rotas de contato).

-- AlterTable
ALTER TABLE "contract_settings" ADD COLUMN "field_defaults" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "contact_personal_data" (
    "contact_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "cpf" TEXT,
    "rg" TEXT,
    "address" TEXT,
    "marital_status" TEXT,
    "nationality" TEXT,
    "birth_date" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,

    CONSTRAINT "contact_personal_data_pkey" PRIMARY KEY ("contact_id")
);

-- CreateIndex
CREATE INDEX "contact_personal_data_organization_id_idx" ON "contact_personal_data"("organization_id");

-- AddForeignKey
ALTER TABLE "contact_personal_data" ADD CONSTRAINT "contact_personal_data_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_personal_data" ADD CONSTRAINT "contact_personal_data_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
