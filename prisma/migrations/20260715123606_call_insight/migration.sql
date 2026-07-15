-- AlterTable
ALTER TABLE "calls" ADD COLUMN     "insight" JSONB,
ADD COLUMN     "insight_state" TEXT DEFAULT 'PENDING',
ADD COLUMN     "transcript" TEXT;

