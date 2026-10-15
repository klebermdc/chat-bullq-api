-- Contratos de guiamento vindos do app do Lovable (pix-magic-contracts).
-- Tabelas novas, sem tocar em nada existente.
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "legacy_id" TEXT,
    "full_name" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "cep" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "requested_dates" TEXT NOT NULL,
    "guide_name" TEXT NOT NULL,
    "seller_name" TEXT,
    "days" INTEGER NOT NULL,
    "people" INTEGER NOT NULL DEFAULT 1,
    "amount" TEXT NOT NULL,
    "pix_key" TEXT,
    "disney_guest" BOOLEAN NOT NULL DEFAULT false,
    "purchased" BOOLEAN NOT NULL DEFAULT false,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "invoice_issued" BOOLEAN NOT NULL DEFAULT false,
    "legacy_chat_url" TEXT,
    "acceptance_token" TEXT,
    "accepted_at" TIMESTAMP(3),
    "client_ip" TEXT,
    "client_user_agent" TEXT,
    "signature_key" TEXT,
    "signed_contract_key" TEXT,
    "payment_receipt_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contracts_acceptance_token_key" ON "contracts"("acceptance_token");
CREATE UNIQUE INDEX "contracts_organization_id_legacy_id_key" ON "contracts"("organization_id", "legacy_id");
CREATE INDEX "contracts_organization_id_guide_name_idx" ON "contracts"("organization_id", "guide_name");
CREATE INDEX "contracts_organization_id_created_at_idx" ON "contracts"("organization_id", "created_at");
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "contract_blocked_dates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "guide_name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'lotado',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_blocked_dates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contract_blocked_dates_organization_id_guide_name_date_key"
  ON "contract_blocked_dates"("organization_id", "guide_name", "date");
ALTER TABLE "contract_blocked_dates" ADD CONSTRAINT "contract_blocked_dates_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "contract_settings" (
    "organization_id" TEXT NOT NULL,
    "terms" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contract_settings_pkey" PRIMARY KEY ("organization_id")
);
ALTER TABLE "contract_settings" ADD CONSTRAINT "contract_settings_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
