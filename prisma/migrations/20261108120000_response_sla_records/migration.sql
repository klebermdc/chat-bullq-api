-- SLA de resposta em horário útil: uma linha por espera do cliente.
-- Só cria tabela nova; nenhuma tabela existente é alterada nem lida (sem
-- backfill). Seguro com o volume atual de conversas.

-- CreateTable
CREATE TABLE "response_sla_records" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "sla_minutes" INTEGER NOT NULL,
    "waiting_since" TIMESTAMP(3) NOT NULL,
    "due_at" TIMESTAMP(3),
    "warned_at" TIMESTAMP(3),
    "breached" BOOLEAN NOT NULL DEFAULT false,
    "breached_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "business_minutes" INTEGER,
    "ended_at" TIMESTAMP(3),
    "end_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "response_sla_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "response_sla_records_organization_id_waiting_since_idx" ON "response_sla_records"("organization_id", "waiting_since");

-- CreateIndex
CREATE INDEX "response_sla_records_agent_id_waiting_since_idx" ON "response_sla_records"("agent_id", "waiting_since");

-- CreateIndex
CREATE UNIQUE INDEX "response_sla_records_conversation_id_waiting_since_key" ON "response_sla_records"("conversation_id", "waiting_since");

-- AddForeignKey
ALTER TABLE "response_sla_records" ADD CONSTRAINT "response_sla_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_sla_records" ADD CONSTRAINT "response_sla_records_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_sla_records" ADD CONSTRAINT "response_sla_records_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- No máximo UMA espera aberta por conversa. Prisma não expressa unique
-- parcial no schema; índice criado via SQL cru (mesmo padrão de
-- uq_active_enrollment_per_conversation).
CREATE UNIQUE INDEX "uq_response_sla_open_per_conversation"
  ON "response_sla_records"("conversation_id")
  WHERE "responded_at" IS NULL AND "ended_at" IS NULL;
