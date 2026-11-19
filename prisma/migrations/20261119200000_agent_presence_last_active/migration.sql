-- Último uso real do dia (saída do ponto na tabela dia a dia da Equipe).
ALTER TABLE "agent_presence_daily" ADD COLUMN IF NOT EXISTS "last_active_at" TIMESTAMP(3);
