-- AlterEnum
ALTER TYPE "AiAgentMode" ADD VALUE 'SHADOW';

-- AlterTable
ALTER TABLE "ai_agent_channels" ADD COLUMN     "tag_filter_id" TEXT;

-- CreateTable
CREATE TABLE "ai_agent_knowledge" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'geral',
    "content" TEXT NOT NULL,
    "question" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "source_examples" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agent_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_ai_knowledge_agent" ON "ai_agent_knowledge"("agent_id");

-- CreateIndex
CREATE INDEX "idx_ai_knowledge_org" ON "ai_agent_knowledge"("organization_id");

-- CreateIndex
CREATE INDEX "idx_ai_agent_channel_tag" ON "ai_agent_channels"("tag_filter_id");

-- AddForeignKey
ALTER TABLE "ai_agent_channels" ADD CONSTRAINT "ai_agent_channels_tag_filter_id_fkey" FOREIGN KEY ("tag_filter_id") REFERENCES "tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_knowledge" ADD CONSTRAINT "ai_agent_knowledge_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_knowledge" ADD CONSTRAINT "ai_agent_knowledge_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
