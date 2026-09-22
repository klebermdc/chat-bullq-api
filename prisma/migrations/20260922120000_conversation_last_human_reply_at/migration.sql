-- Aline de plantão: quando o vendedor da conversa está fora do horário, a
-- Aline responde no lugar dele até um humano responder. Esta coluna guarda a
-- última resposta humana (painel ou app na coexistência); mensagens
-- automáticas não contam.
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "last_human_reply_at" TIMESTAMP(3);
