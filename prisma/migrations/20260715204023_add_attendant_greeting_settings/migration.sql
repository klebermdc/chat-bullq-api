-- CreateTable
CREATE TABLE "attendant_greeting_settings" (
    "organization_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "template" TEXT NOT NULL DEFAULT 'Oi! Sou o {atendente} e vou continuar seu atendimento por aqui 😊',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendant_greeting_settings_pkey" PRIMARY KEY ("organization_id")
);

-- AddForeignKey
ALTER TABLE "attendant_greeting_settings" ADD CONSTRAINT "attendant_greeting_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
