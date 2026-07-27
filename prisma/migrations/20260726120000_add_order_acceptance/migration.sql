-- CreateEnum
CREATE TYPE "AcceptanceStatus" AS ENUM ('PENDING', 'SIGNED', 'EXPIRED', 'CANCELED');

-- CreateTable
CREATE TABLE "order_acceptances" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "card_id" TEXT,
    "token" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "term_text" TEXT NOT NULL,
    "status" "AcceptanceStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "signed_at" TIMESTAMP(3),
    "signer_name" TEXT,
    "signer_ip" TEXT,
    "signer_user_agent" TEXT,
    "pdf_key" TEXT,

    CONSTRAINT "order_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_acceptances_token_key" ON "order_acceptances"("token");

-- CreateIndex
CREATE INDEX "order_acceptances_organization_id_conversation_id_idx" ON "order_acceptances"("organization_id", "conversation_id");

-- CreateIndex
CREATE INDEX "order_acceptances_organization_id_status_idx" ON "order_acceptances"("organization_id", "status");

-- AddForeignKey
ALTER TABLE "order_acceptances" ADD CONSTRAINT "order_acceptances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_acceptances" ADD CONSTRAINT "order_acceptances_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
