-- Unidade POR FAIXA (escada mista h/d). `bands_units` é um array paralelo a
-- `bandsDays`: uma unidade ('DAYS'|'HOURS') por faixa. Vazio = todas em dias
-- (compat com o `bands_unit` global anterior). Aditivo puro.

ALTER TABLE "inactivity_settings"
  ADD COLUMN "bands_units" TEXT[] NOT NULL DEFAULT '{}';
