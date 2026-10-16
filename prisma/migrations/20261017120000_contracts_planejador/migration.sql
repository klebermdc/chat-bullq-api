ALTER TABLE "contracts" ADD COLUMN "planejador_password_enc" TEXT;
ALTER TABLE "contracts" ADD COLUMN "planejador_synced_at" TIMESTAMP(3);
ALTER TABLE "contracts" ADD COLUMN "planejador_error" TEXT;
