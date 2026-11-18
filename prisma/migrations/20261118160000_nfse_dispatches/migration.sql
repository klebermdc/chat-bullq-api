-- NFS-e de guiamento enviada pelo WhatsApp a pedido do OFP Hub.

-- CreateTable
CREATE TABLE "nfse_dispatches" (
    "id" TEXT NOT NULL,
    "envio_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "channel_id" TEXT,
    "contact_id" TEXT,
    "conversation_id" TEXT,
    "phone" TEXT NOT NULL,
    "numero_nfse" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "mode" TEXT,
    "external_id" TEXT,
    "message_id" TEXT,
    "failed_reason" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfse_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nfse_dispatches_envio_id_key" ON "nfse_dispatches"("envio_id");

-- CreateIndex
CREATE INDEX "idx_nfse_dispatch_phone_time" ON "nfse_dispatches"("phone", "created_at");
