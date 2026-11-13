-- CreateEnum
CREATE TYPE "MysteryShopperVisitStatus" AS ENUM ('OPEN', 'EVALUATING', 'DONE', 'FAILED', 'DISCARDED');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "is_mystery_shopper" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "mystery_shopper_numbers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "mystery_shopper_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mystery_shopper_visits" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "number_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "seller_user_id" TEXT,
    "scenario" TEXT,
    "status" "MysteryShopperVisitStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "evaluated_at" TIMESTAMP(3),
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "scores" JSONB NOT NULL DEFAULT '[]',
    "total_score" INTEGER,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "cost_usd" DECIMAL(10,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mystery_shopper_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mystery_shopper_numbers_organization_id_removed_at_idx" ON "mystery_shopper_numbers"("organization_id", "removed_at");

-- CreateIndex
CREATE INDEX "mystery_shopper_numbers_contact_id_idx" ON "mystery_shopper_numbers"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "mystery_shopper_visits_conversation_id_key" ON "mystery_shopper_visits"("conversation_id");

-- CreateIndex
CREATE INDEX "mystery_shopper_visits_organization_id_status_idx" ON "mystery_shopper_visits"("organization_id", "status");

-- CreateIndex
CREATE INDEX "mystery_shopper_visits_organization_id_seller_user_id_evalu_idx" ON "mystery_shopper_visits"("organization_id", "seller_user_id", "evaluated_at");

-- CreateIndex
CREATE INDEX "idx_contact_org_mystery" ON "contacts"("organization_id", "is_mystery_shopper");

-- AddForeignKey
ALTER TABLE "mystery_shopper_numbers" ADD CONSTRAINT "mystery_shopper_numbers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mystery_shopper_numbers" ADD CONSTRAINT "mystery_shopper_numbers_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mystery_shopper_visits" ADD CONSTRAINT "mystery_shopper_visits_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mystery_shopper_visits" ADD CONSTRAINT "mystery_shopper_visits_number_id_fkey" FOREIGN KEY ("number_id") REFERENCES "mystery_shopper_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mystery_shopper_visits" ADD CONSTRAINT "mystery_shopper_visits_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mystery_shopper_visits" ADD CONSTRAINT "mystery_shopper_visits_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

