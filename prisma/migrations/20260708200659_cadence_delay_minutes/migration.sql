ALTER TABLE "cadence_steps" RENAME COLUMN "delay_hours" TO "delay_minutes";
UPDATE "cadence_steps" SET "delay_minutes" = "delay_minutes" * 60;
