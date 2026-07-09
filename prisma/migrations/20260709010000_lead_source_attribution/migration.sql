-- CreateEnum
CREATE TYPE "ConversationSource" AS ENUM ('CTWA', 'SITE_FORM', 'ORGANIC');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "source" "ConversationSource",
                            ADD COLUMN "source_detail" JSONB;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "source" "ConversationSource";

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "lead_intake_secret" TEXT;

-- CreateTable
CREATE TABLE "lead_intakes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "phone_normalized" TEXT NOT NULL,
    "name" TEXT,
    "source" "ConversationSource" NOT NULL,
    "source_detail" JSONB NOT NULL DEFAULT '{}',
    "consumed_at" TIMESTAMP(3),
    "consumed_conversation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lead_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_contact_org_source" ON "contacts"("organization_id", "source");

-- CreateIndex
CREATE INDEX "idx_leadintake_match" ON "lead_intakes"("organization_id", "phone_normalized", "consumed_at");

-- AddForeignKey
ALTER TABLE "lead_intakes" ADD CONSTRAINT "lead_intakes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
