-- AlterTable
ALTER TABLE "mystery_shopper_numbers" ADD COLUMN     "channel_id" TEXT,
ADD COLUMN     "is_simulated" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "mystery_shopper_numbers_channel_id_idx" ON "mystery_shopper_numbers"("channel_id");

-- AddForeignKey
ALTER TABLE "mystery_shopper_numbers" ADD CONSTRAINT "mystery_shopper_numbers_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

