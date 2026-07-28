-- Pasta de figurinhas. Sem backfill de propósito: nenhuma pasta existente vira
-- pasta de figurinha até alguém marcar explicitamente.
ALTER TABLE "media_folders"
  ADD COLUMN "is_sticker_folder" BOOLEAN NOT NULL DEFAULT false;
