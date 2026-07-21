-- CreateTable
CREATE TABLE "whatsapp_windows" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "meta_conversation_id" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'unknown',
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "pricing_model" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "expiration_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_window_pricing" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "rates" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_window_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_window_org_channel_opened" ON "whatsapp_windows"("organization_id", "channel_id", "opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_windows_channel_id_meta_conversation_id_key" ON "whatsapp_windows"("channel_id", "meta_conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_window_pricing_organization_id_key" ON "whatsapp_window_pricing"("organization_id");

-- AddForeignKey
ALTER TABLE "whatsapp_windows" ADD CONSTRAINT "whatsapp_windows_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_windows" ADD CONSTRAINT "whatsapp_windows_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_window_pricing" ADD CONSTRAINT "whatsapp_window_pricing_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

