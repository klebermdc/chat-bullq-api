-- CreateEnum
CREATE TYPE "AdProvider" AS ENUM ('META', 'GOOGLE');

-- CreateEnum
CREATE TYPE "AdConnectionStatus" AS ENUM ('ACTIVE', 'INVALID_TOKEN', 'REVOKED', 'DISABLED');

-- CreateTable
CREATE TABLE "ad_account_connections" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "provider" "AdProvider" NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "account_name" TEXT,
    "currency" TEXT,
    "timezone_name" TEXT,
    "business_id" TEXT,
    "access_token_enc" TEXT NOT NULL,
    "token_scopes" TEXT[],
    "token_expires_at" TIMESTAMP(3),
    "status" "AdConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_sync_at" TIMESTAMP(3),
    "last_sync_error" TEXT,
    "connected_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_account_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_daily_stats" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "ad_id" TEXT NOT NULL,
    "ad_name" TEXT,
    "adset_id" TEXT,
    "adset_name" TEXT,
    "campaign_id" TEXT,
    "campaign_name" TEXT,
    "currency" TEXT NOT NULL,
    "spend" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "link_clicks" INTEGER NOT NULL DEFAULT 0,
    "landing_page_views" INTEGER NOT NULL DEFAULT 0,
    "frequency" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "ctr" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "cpc" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "actions" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ad_account_connections_status_idx" ON "ad_account_connections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ad_account_connections_organization_id_provider_external_ac_key" ON "ad_account_connections"("organization_id", "provider", "external_account_id");

-- CreateIndex
CREATE INDEX "ad_daily_stats_organization_id_date_idx" ON "ad_daily_stats"("organization_id", "date");

-- CreateIndex
CREATE INDEX "ad_daily_stats_organization_id_ad_id_idx" ON "ad_daily_stats"("organization_id", "ad_id");

-- CreateIndex
CREATE UNIQUE INDEX "ad_daily_stats_connection_id_date_ad_id_key" ON "ad_daily_stats"("connection_id", "date", "ad_id");

-- AddForeignKey
ALTER TABLE "ad_account_connections" ADD CONSTRAINT "ad_account_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
