-- AlterTable contacts: colunas de atribuição Click-to-WhatsApp (Meta CAPI)
ALTER TABLE "contacts" ADD COLUMN "ctwa_clid" TEXT;
ALTER TABLE "contacts" ADD COLUMN "ctwa_source_id" TEXT;
ALTER TABLE "contacts" ADD COLUMN "ctwa_source_type" TEXT;
ALTER TABLE "contacts" ADD COLUMN "ctwa_clid_at" TIMESTAMP(3);

-- CreateTable meta_capi_configs (credenciais CAPI por org, token cifrado)
CREATE TABLE "meta_capi_configs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "encrypted_token" TEXT NOT NULL,
    "token_preview" TEXT NOT NULL,
    "test_event_code" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_capi_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable meta_capi_events (log append-only + idempotência via event_id)
CREATE TABLE "meta_capi_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "value" DECIMAL(14,2),
    "currency" TEXT,
    "response_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_capi_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meta_capi_configs_organization_id_key" ON "meta_capi_configs"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "meta_capi_events_event_id_key" ON "meta_capi_events"("event_id");

-- CreateIndex
CREATE INDEX "idx_meta_capi_event_org_status" ON "meta_capi_events"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_meta_capi_event_card" ON "meta_capi_events"("card_id");

-- AddForeignKey
ALTER TABLE "meta_capi_configs" ADD CONSTRAINT "meta_capi_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_capi_events" ADD CONSTRAINT "meta_capi_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
