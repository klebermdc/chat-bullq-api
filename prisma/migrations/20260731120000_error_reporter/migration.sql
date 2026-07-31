-- CreateEnum
CREATE TYPE "ErrorSource" AS ENUM ('API', 'CHANNEL', 'AI', 'JOB');

-- CreateEnum
CREATE TYPE "ErrorSeverity" AS ENUM ('CRITICAL', 'ERROR', 'WARNING');

-- CreateEnum
CREATE TYPE "ErrorIssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'MUTED');

-- CreateEnum
CREATE TYPE "ErrorInvestigationStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "error_issues" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" "ErrorSource" NOT NULL,
    "code" TEXT NOT NULL,
    "severity" "ErrorSeverity" NOT NULL,
    "status" "ErrorIssueStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "last_stack" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_alerted_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "muted_until" TIMESTAMP(3),
    "organization_id" TEXT,
    "investigation_pr_url" TEXT,
    "investigation_status" "ErrorInvestigationStatus",

    CONSTRAINT "error_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_occurrences" (
    "id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "context" JSONB NOT NULL DEFAULT '{}',
    "stack" TEXT,
    "organization_id" TEXT,
    "channel_id" TEXT,
    "conversation_id" TEXT,
    "contact_id" TEXT,
    "user_id" TEXT,

    CONSTRAINT "error_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "error_issues_fingerprint_key" ON "error_issues"("fingerprint");

-- CreateIndex
CREATE INDEX "idx_error_issue_status_time" ON "error_issues"("status", "last_seen_at" DESC);

-- CreateIndex
CREATE INDEX "idx_error_issue_org_time" ON "error_issues"("organization_id", "last_seen_at" DESC);

-- CreateIndex
CREATE INDEX "idx_error_issue_source_sev" ON "error_issues"("source", "severity", "last_seen_at" DESC);

-- CreateIndex
CREATE INDEX "idx_error_issue_first_seen" ON "error_issues"("first_seen_at");

-- CreateIndex
CREATE INDEX "idx_error_occ_issue_time" ON "error_occurrences"("issue_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "idx_error_occ_time" ON "error_occurrences"("occurred_at");

-- AddForeignKey
ALTER TABLE "error_occurrences" ADD CONSTRAINT "error_occurrences_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "error_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

