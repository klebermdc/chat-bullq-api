-- Saudação automática do vendedor tira o lead da aba Esperando sem cumprir o
-- SLA: marca "só a saudação saiu" à parte do awaiting_human_reply.

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "greeted_awaiting_reply" BOOLEAN NOT NULL DEFAULT false;
