import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrgRole } from '@prisma/client';
import * as crypto from 'crypto';
import * as path from 'path';
import { StorageService } from '../storage/storage.service';
import { MediaLibraryRepository } from './media-library.repository';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UploadAssetDto } from './dto/upload-asset.dto';

export interface IncomingFile {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
}

@Injectable()
export class MediaLibraryService {
  // Reúne mídia (imagem/vídeo/documento) + áudio: a biblioteca aceita tudo que
  // o WhatsApp aceita. Áudio é guardado como veio (sem transcodificar).
  static readonly MAX_BYTES = 64 * 1024 * 1024;

  private static readonly ALLOWED_MIME = new Set([
    // image
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
    // video
    'video/mp4', 'video/quicktime', 'video/3gpp', 'video/webm',
    // audio
    'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/ogg', 'audio/wav', 'audio/webm',
    // document
    'application/pdf', 'application/zip', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv',
  ]);

  private readonly publicBaseUrl: string;

  constructor(
    private readonly repository: MediaLibraryRepository,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {
    const appUrl = (this.config.get<string>('APP_URL') || '').replace(/\/$/, '');
    this.publicBaseUrl = `${appUrl}/api/v1/uploads`;
  }

  // ---------- folders ----------
  async createFolder(orgId: string, userId: string, dto: CreateFolderDto) {
    return this.repository.createFolder({
      name: dto.name.trim(),
      isStickerFolder: dto.isStickerFolder ?? false,
      createdById: userId,
      organization: { connect: { id: orgId } },
    });
  }

  async listFolders(orgId: string) {
    return this.repository.findFolders(orgId);
  }

  async updateFolder(
    id: string,
    orgId: string,
    dto: { name?: string; isStickerFolder?: boolean },
  ) {
    const folder = await this.repository.findFolderById(id);
    if (!folder || folder.organizationId !== orgId) {
      throw new NotFoundException('Folder not found');
    }
    return this.repository.updateFolder(id, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.isStickerFolder !== undefined
        ? { isStickerFolder: dto.isStickerFolder }
        : {}),
    });
  }

  /** Figurinhas disponíveis para o compositor (webp em pasta de figurinhas). */
  async listStickers(orgId: string) {
    return this.repository.findStickerAssets(orgId);
  }

  async deleteFolder(id: string, orgId: string, userId: string, role: OrgRole) {
    const folder = await this.repository.findFolderById(id);
    if (!folder || folder.organizationId !== orgId) {
      throw new NotFoundException('Folder not found');
    }
    this.assertCanDelete(folder.createdById, userId, role);
    return this.repository.softDeleteFolder(id);
  }

  // ---------- assets ----------
  async uploadAsset(
    orgId: string,
    userId: string,
    file: IncomingFile,
    dto: UploadAssetDto,
  ) {
    if (!file?.buffer?.byteLength) {
      throw new BadRequestException('Empty upload');
    }
    if (file.buffer.byteLength > MediaLibraryService.MAX_BYTES) {
      throw new BadRequestException(
        `File too large (max ${MediaLibraryService.MAX_BYTES / 1024 / 1024}MB)`,
      );
    }
    const mime = (file.mimetype || 'application/octet-stream').split(';')[0].trim();
    if (!MediaLibraryService.ALLOWED_MIME.has(mime)) {
      throw new BadRequestException(`Unsupported file type: ${mime}`);
    }

    if (dto.folderId) {
      const folder = await this.repository.findFolderById(dto.folderId);
      if (!folder || folder.organizationId !== orgId) {
        throw new NotFoundException('Folder not found');
      }
    }

    const dateFolder = new Date().toISOString().slice(0, 10);
    const id = crypto.randomBytes(16).toString('hex');
    const ext = this.extFor(mime, file.originalname);
    const key = `library/${dateFolder}/${id}${ext}`;

    await this.storage.put(key, file.buffer, mime);

    const url = `${this.publicBaseUrl}/${key}`;
    return this.repository.createAsset({
      url,
      storageKey: key,
      mimeType: mime,
      size: file.buffer.byteLength,
      filename: file.originalname || `${id}${ext}`,
      ...(dto.title ? { title: dto.title.trim() } : {}),
      uploadedById: userId,
      organization: { connect: { id: orgId } },
      ...(dto.folderId ? { folder: { connect: { id: dto.folderId } } } : {}),
    });
  }

  async listAssets(orgId: string, folderId?: string) {
    return this.repository.findAssets(orgId, folderId);
  }

  async deleteAsset(id: string, orgId: string, userId: string, role: OrgRole) {
    const asset = await this.repository.findAssetById(id);
    if (!asset || asset.organizationId !== orgId) {
      throw new NotFoundException('Asset not found');
    }
    this.assertCanDelete(asset.uploadedById, userId, role);
    // Decisão: exclusão é definitiva para o usuário. A linha é soft-deleted
    // (preserva histórico/auditoria e não quebra mensagens já enviadas que
    // apontam para a url), mas o objeto no MinIO é removido de vez — não há
    // "lixeira"/restauração nesta fatia, então não vale reter bytes.
    await this.storage.remove(asset.storageKey);
    return this.repository.softDeleteAsset(id);
  }

  // ---------- helpers ----------
  private assertCanDelete(
    ownerId: string | null,
    userId: string,
    role: OrgRole,
  ): void {
    const isAdmin = role === OrgRole.OWNER || role === OrgRole.ADMIN;
    if (!isAdmin && ownerId !== userId) {
      throw new ForbiddenException(
        'Só quem enviou o arquivo ou um administrador pode excluí-lo',
      );
    }
  }

  private extFor(mime: string, originalFilename?: string): string {
    if (originalFilename) {
      const ext = path.extname(originalFilename).toLowerCase();
      if (ext && /^\.[a-z0-9]{1,8}$/i.test(ext)) return ext;
    }
    const m = mime.toLowerCase();
    if (m.includes('ogg')) return '.ogg';
    if (m === 'audio/mpeg') return '.mp3';
    if (m === 'audio/m4a' || m === 'audio/mp4') return '.m4a';
    if (m.includes('wav')) return '.wav';
    if (m === 'audio/webm') return '.webm';
    if (m === 'image/jpeg' || m === 'image/jpg') return '.jpg';
    if (m === 'image/png') return '.png';
    if (m === 'image/gif') return '.gif';
    if (m === 'image/webp') return '.webp';
    if (m === 'image/heic') return '.heic';
    if (m === 'video/mp4') return '.mp4';
    if (m === 'video/quicktime') return '.mov';
    if (m === 'video/3gpp') return '.3gp';
    if (m === 'video/webm') return '.webm';
    if (m === 'application/pdf') return '.pdf';
    if (m === 'application/zip') return '.zip';
    if (m === 'application/msword') return '.doc';
    if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return '.docx';
    if (m === 'application/vnd.ms-excel') return '.xls';
    if (m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return '.xlsx';
    if (m === 'application/vnd.ms-powerpoint') return '.ppt';
    if (m === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return '.pptx';
    if (m === 'text/plain') return '.txt';
    if (m === 'text/csv') return '.csv';
    return '.bin';
  }
}
