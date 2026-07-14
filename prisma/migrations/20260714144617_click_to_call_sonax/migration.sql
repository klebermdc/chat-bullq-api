-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('DIALING', 'RINGING', 'TALKING', 'ANSWERED', 'NO_ANSWER', 'BUSY', 'FAILED', 'FINISHED');

-- AlterTable
ALTER TABLE "user_organizations" ADD COLUMN     "sonax_ramal" TEXT;

-- CreateTable
CREATE TABLE "sonax_settings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "id_cliente" TEXT NOT NULL,
    "token_enc" TEXT NOT NULL,
    "webhook_secret" TEXT NOT NULL,
    "click2call_base_url" TEXT NOT NULL DEFAULT 'https://click2call.sonax.net.br/sonax-click2call.php',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sonax_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "ramal" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'DIALING',
    "answered" BOOLEAN NOT NULL DEFAULT false,
    "duration_sec" INTEGER,
    "recording_url" TEXT,
    "message_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "raw" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sonax_settings_organization_id_key" ON "sonax_settings"("organization_id");

-- CreateIndex
CREATE INDEX "calls_organization_id_started_at_idx" ON "calls"("organization_id", "started_at");

-- CreateIndex
CREATE INDEX "calls_conversation_id_idx" ON "calls"("conversation_id");

-- AddForeignKey
ALTER TABLE "sonax_settings" ADD CONSTRAINT "sonax_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

