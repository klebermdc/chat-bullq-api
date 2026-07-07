-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "ai_summary" TEXT,
ADD COLUMN     "ai_summary_at" TIMESTAMP(3),
ADD COLUMN     "ai_summary_sentiment" TEXT,
ADD COLUMN     "ai_summary_up_to_at" TIMESTAMP(3);
