-- CreateTable
CREATE TABLE "whatsapp_message_billing" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "external_message_id" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'unknown',
    "pricing_type" TEXT,
    "billable" BOOLEAN NOT NULL,
    "pricing_model" TEXT,
    "status_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_message_billing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_billing_org_status_at" ON "whatsapp_message_billing"("organization_id", "status_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_message_billing_channel_id_external_message_id_key" ON "whatsapp_message_billing"("channel_id", "external_message_id");

-- AddForeignKey
ALTER TABLE "whatsapp_message_billing" ADD CONSTRAINT "whatsapp_message_billing_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_message_billing" ADD CONSTRAINT "whatsapp_message_billing_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
