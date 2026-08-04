-- CreateEnum
CREATE TYPE "EmailSubscriberStatus" AS ENUM ('SUBSCRIBED', 'UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED');

-- CreateEnum
CREATE TYPE "EmailSubscriberSource" AS ENUM ('CRM_CONTACT', 'OFP_ORDER', 'CSV_IMPORT', 'OPT_IN_FORM', 'MANUAL');

-- CreateEnum
CREATE TYPE "EmailCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'PAUSED', 'SENT', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "EmailMessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED');

-- CreateTable
CREATE TABLE "email_subscribers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" "EmailSubscriberStatus" NOT NULL DEFAULT 'SUBSCRIBED',
    "source" "EmailSubscriberSource" NOT NULL,
    "contact_id" TEXT,
    "consent_at" TIMESTAMP(3),
    "consent_source" TEXT,
    "unsubscribed_at" TIMESTAMP(3),
    "suppressed_reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_campaigns" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "from_name" TEXT,
    "content" JSONB NOT NULL,
    "audience_filter" JSONB NOT NULL,
    "status" "EmailCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "subscriber_id" TEXT,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "provider_id" TEXT,
    "dedup_key" TEXT,
    "status" "EmailMessageStatus" NOT NULL DEFAULT 'PENDING',
    "failed_reason" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "first_clicked_at" TIMESTAMP(3),
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "message_id" TEXT,
    "provider_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_subscribers_organization_id_status_idx" ON "email_subscribers"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "email_subscribers_organization_id_email_key" ON "email_subscribers"("organization_id", "email");

-- CreateIndex
CREATE INDEX "email_campaigns_organization_id_status_idx" ON "email_campaigns"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_provider_id_key" ON "email_messages"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_dedup_key_key" ON "email_messages"("dedup_key");

-- CreateIndex
CREATE INDEX "email_messages_organization_id_campaign_id_status_idx" ON "email_messages"("organization_id", "campaign_id", "status");

-- CreateIndex
CREATE INDEX "email_events_provider_id_idx" ON "email_events"("provider_id");

-- CreateIndex
CREATE INDEX "email_events_organization_id_type_occurred_at_idx" ON "email_events"("organization_id", "type", "occurred_at");

-- AddForeignKey
ALTER TABLE "email_subscribers" ADD CONSTRAINT "email_subscribers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

