-- AlterTable
ALTER TABLE "email_subscribers" ADD COLUMN     "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "enriched_at" TIMESTAMP(3),
ADD COLUMN     "first_purchase_at" TIMESTAMP(3),
ADD COLUMN     "last_purchase_at" TIMESTAMP(3),
ADD COLUMN     "order_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "suppliers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "total_spent" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "email_subscriber_tags" (
    "subscriber_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_subscriber_tags_pkey" PRIMARY KEY ("subscriber_id","tag_id")
);

-- CreateIndex
CREATE INDEX "email_subscriber_tags_tag_id_idx" ON "email_subscriber_tags"("tag_id");

-- CreateIndex
CREATE INDEX "email_subscribers_organization_id_status_last_purchase_at_idx" ON "email_subscribers"("organization_id", "status", "last_purchase_at");

-- AddForeignKey
ALTER TABLE "email_subscriber_tags" ADD CONSTRAINT "email_subscriber_tags_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "email_subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_subscriber_tags" ADD CONSTRAINT "email_subscriber_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

