-- Adiciona o gatilho COMMENT_RECEIVED.
--
-- IMPORTANTE: esta migração SÓ adiciona o valor ao enum, sem usá-lo em lugar
-- nenhum. `ALTER TYPE ... ADD VALUE` seguido do USO do valor novo na MESMA
-- migração quebra o `prisma migrate deploy` (o Postgres não enxerga o valor
-- recém-criado dentro da mesma transação). Já quebramos o deploy assim uma
-- vez na migração do cadence_revive — se precisar usar COMMENT_RECEIVED em
-- DDL, faça em uma migração posterior.
ALTER TYPE "AutomationTrigger" ADD VALUE 'COMMENT_RECEIVED';
