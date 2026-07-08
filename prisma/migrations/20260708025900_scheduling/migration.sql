-- CreateEnum
CREATE TYPE "ScheduledMessageStatus" AS ENUM ('PENDING', 'SENT', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "ScheduledMessageOrigin" AS ENUM ('MANUAL', 'AUTO_REENGAGE');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "inactivity_band" INTEGER,
ADD COLUMN     "last_inbound_at" TIMESTAMP(3),
ADD COLUMN     "last_outbound_at" TIMESTAMP(3),
ADD COLUMN     "reengage_dismissed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "scheduled_messages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "origin" "ScheduledMessageOrigin" NOT NULL DEFAULT 'MANUAL',
    "contentType" "MessageContentType" NOT NULL DEFAULT 'TEXT',
    "content" JSONB NOT NULL,
    "quick_reply_id" TEXT,
    "template_id" TEXT,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledMessageStatus" NOT NULL DEFAULT 'PENDING',
    "job_id" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "retry_every_hours" INTEGER,
    "cancel_on_reply" BOOLEAN NOT NULL DEFAULT false,
    "sent_message_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "failed_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inactivity_settings" (
    "organization_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "bandsDays" JSONB NOT NULL DEFAULT '[3, 7, 15, 30]',
    "auto_reengage" BOOLEAN NOT NULL DEFAULT false,
    "reengage_from_band" INTEGER NOT NULL DEFAULT 1,
    "max_attempts" INTEGER NOT NULL DEFAULT 2,
    "retry_every_hours" INTEGER NOT NULL DEFAULT 48,
    "quiet_hours_start" INTEGER,
    "quiet_hours_end" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inactivity_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateIndex
CREATE INDEX "idx_sched_org_status_time" ON "scheduled_messages"("organization_id", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "idx_sched_conv_status" ON "scheduled_messages"("conversation_id", "status");

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inactivity_settings" ADD CONSTRAINT "inactivity_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
