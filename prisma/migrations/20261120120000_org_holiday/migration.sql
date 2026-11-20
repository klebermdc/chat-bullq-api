-- Feriado: Aline no comando até ai_holiday_until.
ALTER TABLE "organizations" ADD COLUMN "ai_holiday_until" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "ai_holiday_started_at" TIMESTAMP(3);
