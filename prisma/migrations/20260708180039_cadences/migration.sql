-- CreateEnum
CREATE TYPE "CadenceTrigger" AS ENUM ('STAGE_ENTER', 'MANUAL', 'BOTH');

-- CreateEnum
CREATE TYPE "CadenceStepOption" AS ENUM ('SIM', 'NAO', 'DESCADASTRAR');

-- CreateEnum
CREATE TYPE "CadenceEnrollmentStatus" AS ENUM ('ACTIVE', 'HANDED_OFF', 'STOPPED_OPTOUT', 'MOVED_LOST', 'COMPLETED_NO_REPLY');

-- AlterEnum
ALTER TYPE "ScheduledMessageOrigin" ADD VALUE 'CADENCE';

-- AlterTable
ALTER TABLE "scheduled_messages" ADD COLUMN     "cadence_enrollment_id" TEXT,
ADD COLUMN     "cadence_step_order" INTEGER;

-- CreateTable
CREATE TABLE "cadences" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pipeline_id" TEXT,
    "stage_id" TEXT,
    "lost_stage_id" TEXT,
    "hot_tag_id" TEXT,
    "opt_out_tag_id" TEXT,
    "trigger" "CadenceTrigger" NOT NULL DEFAULT 'BOTH',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "allow_manual" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cadences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cadence_steps" (
    "id" TEXT NOT NULL,
    "cadence_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "delay_hours" INTEGER NOT NULL,
    "contentType" "MessageContentType" NOT NULL DEFAULT 'TEXT',
    "content" JSONB NOT NULL,
    "options" "CadenceStepOption"[],
    "template_id" TEXT,

    CONSTRAINT "cadence_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cadence_enrollments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "cadence_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "card_id" TEXT,
    "contact_id" TEXT NOT NULL,
    "current_step" INTEGER NOT NULL DEFAULT 1,
    "status" "CadenceEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_step_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "end_reason" TEXT,

    CONSTRAINT "cadence_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cadences_organization_id_stage_id_idx" ON "cadences"("organization_id", "stage_id");

-- CreateIndex
CREATE UNIQUE INDEX "cadence_steps_cadence_id_order_key" ON "cadence_steps"("cadence_id", "order");

-- CreateIndex
CREATE INDEX "cadence_enrollments_conversation_id_status_idx" ON "cadence_enrollments"("conversation_id", "status");

-- CreateIndex
CREATE INDEX "cadence_enrollments_organization_id_status_idx" ON "cadence_enrollments"("organization_id", "status");

-- AddForeignKey
ALTER TABLE "cadences" ADD CONSTRAINT "cadences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cadence_steps" ADD CONSTRAINT "cadence_steps_cadence_id_fkey" FOREIGN KEY ("cadence_id") REFERENCES "cadences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cadence_enrollments" ADD CONSTRAINT "cadence_enrollments_cadence_id_fkey" FOREIGN KEY ("cadence_id") REFERENCES "cadences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cadence_enrollments" ADD CONSTRAINT "cadence_enrollments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
