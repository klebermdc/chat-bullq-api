-- CreateEnum
CREATE TYPE "AppointmentKind" AS ENUM ('RETORNO_LIGACAO', 'REUNIAO');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('MARCADO', 'FEITO', 'CANCELADO', 'NAO_ATENDEU');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('ALINE_VOZ', 'ALINE_CHAT', 'MANUAL');

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "card_id" TEXT,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_min" INTEGER NOT NULL DEFAULT 15,
    "kind" "AppointmentKind" NOT NULL DEFAULT 'RETORNO_LIGACAO',
    "status" "AppointmentStatus" NOT NULL DEFAULT 'MARCADO',
    "source" "AppointmentSource" NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "call_id" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_appointment_owner_time" ON "appointments"("organization_id", "owner_user_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_conversation_id_idx" ON "appointments"("conversation_id");

-- CreateIndex
CREATE INDEX "appointments_contact_id_idx" ON "appointments"("contact_id");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

