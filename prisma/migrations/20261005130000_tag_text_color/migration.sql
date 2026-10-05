-- Cor da letra da etiqueta, escolhida em Configurações > Tags.
-- Nula = automática (o front deriva a letra a partir de "color").
ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "text_color" TEXT;
