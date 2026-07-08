-- CreateTable
CREATE TABLE "recovery_settings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "outreach_channel_id" TEXT,
    "opener_template_name" TEXT,
    "followup_template_name" TEXT,
    "template_lang" TEXT NOT NULL DEFAULT 'pt_BR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recovery_settings_organization_id_key" ON "recovery_settings"("organization_id");

-- AddForeignKey
ALTER TABLE "recovery_settings" ADD CONSTRAINT "recovery_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
