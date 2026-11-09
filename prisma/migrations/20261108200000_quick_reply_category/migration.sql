-- Categoria da mensagem rápida: agrupa a janela do atendente (ex.: "Disney").
-- Nula = "Outras".
ALTER TABLE "quick_replies" ADD COLUMN IF NOT EXISTS "category" TEXT;
