-- AlterEnum
ALTER TYPE "AutomationRunStatus" ADD VALUE 'WAITING';

-- AlterTable
ALTER TABLE "automation_runs" ADD COLUMN     "resume_at" TIMESTAMP(3),
ADD COLUMN     "resume_action_index" INTEGER,
ADD COLUMN     "resume_state" JSONB;

-- CreateIndex
CREATE INDEX "idx_run_status_resume" ON "automation_runs"("status", "resume_at");
