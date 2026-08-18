-- CreateTable
CREATE TABLE "social_comments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "external_comment_id" TEXT NOT NULL,
    "parent_comment_id" TEXT,
    "post_id" TEXT NOT NULL,
    "post_permalink" TEXT,
    "author_external_id" TEXT NOT NULL,
    "author_username" TEXT,
    "contact_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "private_reply_at" TIMESTAMP(3),
    "private_reply_error" TEXT,
    "public_reply_at" TIMESTAMP(3),
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_comments_organization_id_created_at_idx" ON "social_comments"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "social_comments_contact_id_idx" ON "social_comments"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_social_comment_channel_external" ON "social_comments"("channel_id", "external_comment_id");

-- AddForeignKey
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
