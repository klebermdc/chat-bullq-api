-- AlterEnum
ALTER TYPE "CadenceTrigger" ADD VALUE IF NOT EXISTS 'NO_REPLY';

-- AlterEnum
ALTER TYPE "CadenceEnrollmentStatus" ADD VALUE IF NOT EXISTS 'RESUMED_AI';

-- AlterTable
ALTER TABLE "cadences" ADD COLUMN     "watched_stage_ids" TEXT[] NOT NULL DEFAULT '{}';
