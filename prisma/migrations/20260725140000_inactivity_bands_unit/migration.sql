-- Unidade das faixas de inatividade: 'DAYS' (default, preserva comportamento
-- atual) ou 'HOURS'. Aditivo puro (NOT NULL DEFAULT 'DAYS').

ALTER TABLE "inactivity_settings"
  ADD COLUMN "bands_unit" TEXT NOT NULL DEFAULT 'DAYS';
