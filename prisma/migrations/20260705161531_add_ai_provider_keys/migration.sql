-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('GROQ', 'OPENAI', 'SAKANA');

-- CreateEnum
CREATE TYPE "AiCapability" AS ENUM ('TRANSCRIPTION', 'EMBEDDINGS', 'AGENT_LLM');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'AI_TOOL_FAILURE';

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_revoked_by_fkey";

-- AlterTable
ALTER TABLE "ai_agents" ADD COLUMN     "department" TEXT,
ADD COLUMN     "operational_context" TEXT,
ADD COLUMN     "operational_context_updated_at" TIMESTAMP(3),
ADD COLUMN     "parent_agent_id" TEXT,
ADD COLUMN     "squad" TEXT;

-- AlterTable
ALTER TABLE "webhook_subscriptions" ALTER COLUMN "events" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ai_provider_keys" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "encrypted_key" TEXT NOT NULL,
    "key_preview" TEXT NOT NULL,
    "capabilities" "AiCapability"[],
    "base_url" TEXT,
    "model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_ai_provider_key_org" ON "ai_provider_keys"("organization_id");

-- CreateIndex
CREATE INDEX "idx_ai_agent_parent" ON "ai_agents"("parent_agent_id");

-- CreateIndex
CREATE INDEX "idx_ai_agent_org_dept" ON "ai_agents"("organization_id", "department");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_parent_agent_id_fkey" FOREIGN KEY ("parent_agent_id") REFERENCES "ai_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_provider_keys" ADD CONSTRAINT "ai_provider_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "uq_pipeline_org_key" RENAME TO "pipelines_organization_id_key_key";
