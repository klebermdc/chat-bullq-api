-- CreateEnum
CREATE TYPE "MysteryShopperBotStatus" AS ENUM ('ACTIVE', 'CLOSING', 'ENDED', 'STOPPED', 'FAILED');

-- CreateTable
CREATE TABLE "mystery_shopper_bot_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "number_id" TEXT NOT NULL,
    "persona" TEXT NOT NULL,
    "status" "MysteryShopperBotStatus" NOT NULL DEFAULT 'ACTIVE',
    "client_messages" INTEGER NOT NULL DEFAULT 0,
    "follow_up_answered" BOOLEAN NOT NULL DEFAULT false,
    "last_error" TEXT,
    "cost_usd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "mystery_shopper_bot_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mystery_shopper_bot_runs_number_id_status_idx" ON "mystery_shopper_bot_runs"("number_id", "status");

-- AddForeignKey
ALTER TABLE "mystery_shopper_bot_runs" ADD CONSTRAINT "mystery_shopper_bot_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mystery_shopper_bot_runs" ADD CONSTRAINT "mystery_shopper_bot_runs_number_id_fkey" FOREIGN KEY ("number_id") REFERENCES "mystery_shopper_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

