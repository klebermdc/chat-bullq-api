-- Contratos parte 2A: datas estruturadas, evidência do aceite e configurações.
ALTER TABLE "contracts" ADD COLUMN "park_dates" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "contracts" ADD COLUMN "dates_to_be_defined" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contracts" ADD COLUMN "notes" TEXT;
ALTER TABLE "contracts" ADD COLUMN "payment_method" TEXT;
ALTER TABLE "contracts" ADD COLUMN "accepted_terms_text" TEXT;
ALTER TABLE "contracts" ADD COLUMN "acceptance_pdf_key" TEXT;
ALTER TABLE "contracts" ADD COLUMN "created_by_id" TEXT;

ALTER TABLE "contract_settings" ADD COLUMN "pix_keys" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "contract_settings" ADD COLUMN "default_pix_key" TEXT;
ALTER TABLE "contract_settings" ADD COLUMN "receipt_notify_email" TEXT;
ALTER TABLE "contract_settings" ADD COLUMN "usd_payment_instructions" TEXT;
ALTER TABLE "contract_settings" ADD COLUMN "guides" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "contract_settings" ADD COLUMN "sellers" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "contract_settings" ADD COLUMN "company_name" TEXT;
ALTER TABLE "contract_settings" ADD COLUMN "company_document" TEXT;
ALTER TABLE "contract_settings" ADD COLUMN "company_address" TEXT;

-- Contrato "datas a definir" importado: o Lovable gravava o texto literal.
UPDATE "contracts" SET "dates_to_be_defined" = true WHERE "requested_dates" = 'Datas a definir';
