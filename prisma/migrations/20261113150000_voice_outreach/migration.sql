-- CreateTable
CREATE TABLE "voice_outreach" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "permission_status" TEXT,
    "permission_requested_at" TIMESTAMP(3),
    "permission_note" TEXT,
    "call_status" TEXT,
    "called_at" TIMESTAMP(3),
    "room" TEXT,
    "call_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_outreach_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_outreach_proposal_id_key" ON "voice_outreach"("proposal_id");

-- CreateIndex
CREATE INDEX "voice_outreach_organization_id_call_status_idx" ON "voice_outreach"("organization_id", "call_status");

-- AddForeignKey
ALTER TABLE "voice_outreach" ADD CONSTRAINT "voice_outreach_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_outreach" ADD CONSTRAINT "voice_outreach_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

