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
    // desanexa os assets da pasta antes de removê-la
    await this.prisma.mediaAsset.updateMany({
      where: { folderId: id, deletedAt: null },
      data: { folderId: null },
    });
    return this.prisma.mediaFolder.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
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
