import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class MediaLibraryRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ----- folders -----
  async createFolder(data: Prisma.MediaFolderCreateInput) {
    return this.prisma.mediaFolder.create({ data });
  }

  async findFolders(organizationId: string) {
    return this.prisma.mediaFolder.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async findFolderById(id: string) {
    return this.prisma.mediaFolder.findFirst({
      where: { id, deletedAt: null },
    });
  }

  async softDeleteFolder(id: string) {
    // Desanexa os assets antes de remover a pasta. O FK é ON DELETE SET NULL,
    // mas isso só dispara em hard-delete — no soft-delete o detach é manual.
    // $transaction garante que assets não fiquem órfãos de uma pasta ainda viva
    // se o segundo update falhar.
    const [, folder] = await this.prisma.$transaction([
      this.prisma.mediaAsset.updateMany({
        where: { folderId: id, deletedAt: null },
        data: { folderId: null },
      }),
      this.prisma.mediaFolder.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    ]);
    return folder;
  }

  // ----- assets -----
  async createAsset(data: Prisma.MediaAssetCreateInput) {
    return this.prisma.mediaAsset.create({ data });
  }

  async findAssets(organizationId: string, folderId?: string) {
    return this.prisma.mediaAsset.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(folderId ? { folderId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAssetById(id: string) {
    return this.prisma.mediaAsset.findFirst({
      where: { id, deletedAt: null },
    });
  }

  async softDeleteAsset(id: string) {
    return this.prisma.mediaAsset.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
