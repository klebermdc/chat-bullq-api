-- CreateTable
CREATE TABLE "media_folders" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "media_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "folder_id" TEXT,
    "uploaded_by_id" TEXT,
    "url" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_folders_organization_id_deleted_at_idx" ON "media_folders"("organization_id", "deleted_at");

-- CreateIndex
CREATE INDEX "media_assets_organization_id_folder_id_deleted_at_idx" ON "media_assets"("organization_id", "folder_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "media_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
