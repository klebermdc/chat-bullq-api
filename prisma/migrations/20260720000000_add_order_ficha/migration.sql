-- CreateEnum
CREATE TYPE "OrderFichaStatus" AS ENUM ('NO_ORDER', 'ORDER_LOGGED', 'CART_SENT', 'DIVERGENT', 'MATCHED');

-- CreateTable
CREATE TABLE "order_fichas" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "travel_dates_text" TEXT,
    "travel_start" TIMESTAMP(3),
    "travel_end" TIMESTAMP(3),
    "requested_at" TIMESTAMP(3),
    "source_message_id" TEXT,
    "last_proposal_id" TEXT,
    "divergences" JSONB NOT NULL DEFAULT '[]',
    "status" "OrderFichaStatus" NOT NULL DEFAULT 'NO_ORDER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_fichas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_fichas_conversation_id_key" ON "order_fichas"("conversation_id");

-- CreateIndex
CREATE INDEX "order_fichas_organization_id_contact_id_idx" ON "order_fichas"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX "order_fichas_organization_id_status_idx" ON "order_fichas"("organization_id", "status");

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "has_order_divergence" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "order_fichas" ADD CONSTRAINT "order_fichas_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_fichas" ADD CONSTRAINT "order_fichas_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
