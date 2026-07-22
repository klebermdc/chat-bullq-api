-- Adiciona o valor LEAD_QUALIFIED ao enum AutomationTrigger.
--
-- ATENÇÃO: esta migração faz SOMENTE o ALTER TYPE, de propósito.
-- O Postgres não permite USAR um valor de enum na mesma transação em que ele
-- foi adicionado (55P04 / P3018) — foi exatamente assim que a migração
-- cadence_revive quebrou o deploy. Qualquer índice, default ou DML que
-- referencie 'LEAD_QUALIFIED' precisa ficar numa migração POSTERIOR.
ALTER TYPE "AutomationTrigger" ADD VALUE IF NOT EXISTS 'LEAD_QUALIFIED';
