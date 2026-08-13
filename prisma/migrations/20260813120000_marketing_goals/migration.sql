-- CreateTable
CREATE TABLE "marketing_goals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "monthly_budget" DECIMAL(14,2),
    "target_cpl" DECIMAL(14,2),
    "target_ctr_pct" DECIMAL(6,2),
    "target_leads_per_day" INTEGER,
    "target_frequency_max" DECIMAL(6,2),
    "target_conversion_pct" DECIMAL(6,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketing_goals_organization_id_key" ON "marketing_goals"("organization_id");

-- AddForeignKey
ALTER TABLE "marketing_goals" ADD CONSTRAINT "marketing_goals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
