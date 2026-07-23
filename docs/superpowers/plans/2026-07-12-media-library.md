# Biblioteca de Arquivos compartilhada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a cada organização uma biblioteca de mídia compartilhada, organizada em pastas livres, onde qualquer atendente sobe um arquivo (imagem/áudio/vídeo/documento) e todos os outros podem reusá-lo para enviar ao cliente direto do compositor.

**Architecture:** Backend NestJS espelha o módulo `quick-replies` (org-scoped, soft-delete): novos modelos Prisma `MediaFolder`/`MediaAsset`, módulo `media-library` (controller/service/repository/dto). O upload reusa o `StorageService` global (MinIO/S3); enviar da biblioteca **não muda o pipeline de envio** — o front chama o `POST /messages` já existente passando `content.mediaUrl` do asset. No web, o clipe do compositor passa a abrir um `Dropdown` (origem: dispositivo vs biblioteca); a biblioteca vive num modal modelado no `template-picker-dialog`.

**Tech Stack:** NestJS, Prisma, MinIO (StorageService), Jest (unit com fake repo em memória) · Next.js (App Router), Tailwind v4, Headless UI, axios, TanStack Query, sonner, lucide-react.

**Repos:**
- API: `/Users/kleber/Desktop/agent-browser-0.2.0 2/Teste.md/Chat OFP/chat-bullq-api`
- Web: `/Users/kleber/Desktop/agent-browser-0.2.0 2/Teste.md/Chat OFP/chat-bullq-web`

**Permissões (regra do produto):** criar pasta e subir arquivo → qualquer AGENT. Excluir arquivo → só quem subiu (`uploadedById`) ou ADMIN/OWNER. Excluir pasta → só quem criou (`createdById`) ou ADMIN/OWNER; assets da pasta ficam sem pasta (`folderId = null`), não são apagados.

---

## File Structure

**API (novo módulo `src/modules/media-library/`):**
- `dto/create-folder.dto.ts` — valida `{ name }`
- `dto/upload-asset.dto.ts` — valida `{ folderId?, title? }` (campos multipart)
- `media-library.repository.ts` — acesso Prisma, sempre filtra `organizationId` + `deletedAt: null`
- `media-library.service.ts` — regras (org scoping, upload via StorageService, permissões de exclusão)
- `media-library.service.spec.ts` — unit com fake repo/storage
- `media-library.controller.ts` — rotas guardadas
- `media-library.module.ts` — registra tudo
- `prisma/schema.prisma` — modelos `MediaFolder`, `MediaAsset` + back-relations em `Organization`
- `src/modules/storage/storage.service.ts` — adiciona `remove(key)`
- `src/app.module.ts` — importa `MediaLibraryModule`

**Web (novo `src/features/media-library/`):**
- `services/media-library.service.ts` — chamadas axios
- `components/media-library-dialog.tsx` — modal (pastas + grid + upload + criar pasta + enviar)
- `src/features/inbox/services/inbox.service.ts` — método `sendLibraryMedia`
- `src/features/inbox/components/chat-input.tsx` — chooser de origem no clipe

---

## Task 1: Prisma models `MediaFolder` + `MediaAsset`

**Files:**
- Modify: `prisma/schema.prisma` (model `Organization`, ~linha 131; adicionar 2 modelos novos no fim do arquivo)

- [ ] **Step 1: Adicionar back-relations no model `Organization`**

Localize o model `Organization` (a linha `model Organization {`). Junto das outras relações de coleção (ex. `quickReplies QuickReply[]`), adicione:

```prisma
  mediaFolders   MediaFolder[]
  mediaAssets    MediaAsset[]
```

- [ ] **Step 2: Adicionar os dois modelos novos ao final de `prisma/schema.prisma`**

```prisma
model MediaFolder {
  id             String    @id @default(cuid())
  organizationId String    @map("organization_id")
  name           String
  createdById    String?   @map("created_by_id")
  createdAt      DateTime  @default(now()) @map("created_at")
  deletedAt      DateTime? @map("deleted_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  assets       MediaAsset[]

  @@index([organizationId, deletedAt])
  @@map("media_folders")
}

model MediaAsset {
  id             String    @id @default(cuid())
  organizationId String    @map("organization_id")
  folderId       String?   @map("folder_id")
  uploadedById   String?   @map("uploaded_by_id")
  url            String
  storageKey     String    @map("storage_key")
  mimeType       String    @map("mime_type")
  size           Int
  filename       String
  title          String?
  createdAt      DateTime  @default(now()) @map("created_at")
  deletedAt      DateTime? @map("deleted_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  folder       MediaFolder? @relation(fields: [folderId], references: [id], onDelete: SetNull)

  @@index([organizationId, folderId, deletedAt])
  @@map("media_assets")
}
```

- [ ] **Step 3: Gerar a migração e o client**

Run: `cd chat-bullq-api && npx prisma migrate dev --name media_library`
Expected: cria `prisma/migrations/<timestamp>_media_library/migration.sql` com `CREATE TABLE "media_folders"` e `"media_assets"`, e regenera o Prisma Client sem erro.

- [ ] **Step 4: Confirmar que o client compila com os novos tipos**

Run: `cd chat-bullq-api && npx tsc --noEmit`
Expected: sem erros (os tipos `Prisma.MediaFolderCreateInput` / `MediaAssetCreateInput` passam a existir).

- [ ] **Step 5: Commit**

```bash
cd chat-bullq-api
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(media-library): modelos MediaFolder e MediaAsset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `StorageService.remove(key)`

O `StorageService` não sabe apagar objetos; a exclusão de asset precisa remover o arquivo do MinIO.

**Files:**
- Modify: `src/modules/storage/storage.service.ts`
- Test: `src/modules/storage/storage.service.spec.ts` (criar)

- [ ] **Step 1: Escrever o teste que falha**

Create `src/modules/storage/storage.service.spec.ts`:

```typescript
import { StorageService } from './storage.service';

function build() {
  const config = { get: (k: string) => undefined } as any;
  const service = new StorageService(config);
  // injeta um client MinIO falso
  const removeObject = jest.fn(async () => undefined);
  (service as any).client = { removeObject };
  (service as any).bucket = 'test-bucket';
  return { service, removeObject };
}

describe('StorageService.remove', () => {
  it('remove o objeto pela key no bucket configurado', async () => {
    const { service, removeObject } = build();
    await service.remove('library/2026-07-12/abc.jpg');
    expect(removeObject).toHaveBeenCalledWith('test-bucket', 'library/2026-07-12/abc.jpg');
  });

  it('não lança quando o objeto já não existe (NoSuchKey)', async () => {
    const { service } = build();
    (service as any).client.removeObject = jest.fn(async () => {
      throw { code: 'NoSuchKey' };
    });
    await expect(service.remove('library/x.jpg')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd chat-bullq-api && npx jest src/modules/storage/storage.service.spec.ts`
Expected: FAIL — `service.remove is not a function`.

- [ ] **Step 3: Implementar `remove`**

Em `src/modules/storage/storage.service.ts`, adicione o método logo após `put` (usa o helper `isNotFound` já existente na classe):

```typescript
  /** Remove um objeto. Idempotente: um objeto inexistente é sucesso. */
  async remove(key: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, key);
    } catch (err: any) {
      if (this.isNotFound(err)) return;
      throw err;
    }
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd chat-bullq-api && npx jest src/modules/storage/storage.service.spec.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
cd chat-bullq-api
git add src/modules/storage/storage.service.ts src/modules/storage/storage.service.spec.ts
git commit -m "feat(storage): StorageService.remove para apagar objetos do MinIO

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: DTOs

**Files:**
- Create: `src/modules/media-library/dto/create-folder.dto.ts`
- Create: `src/modules/media-library/dto/upload-asset.dto.ts`

- [ ] **Step 1: `create-folder.dto.ts`**

```typescript
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateFolderDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;
}
```

- [ ] **Step 2: `upload-asset.dto.ts`**

Campos multipart chegam como string; `folderId` e `title` são opcionais.

```typescript
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UploadAssetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  folderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}
```

- [ ] **Step 3: Commit**

```bash
cd chat-bullq-api
git add src/modules/media-library/dto
git commit -m "feat(media-library): DTOs de pasta e upload

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `MediaLibraryRepository`

Sempre filtra por `organizationId` e `deletedAt: null` (padrão `quick-replies.repository.ts`).

**Files:**
- Create: `src/modules/media-library/media-library.repository.ts`

- [ ] **Step 1: Implementar o repository**

```typescript
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
```

- [ ] **Step 2: Confirmar compilação**

Run: `cd chat-bullq-api && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
cd chat-bullq-api
git add src/modules/media-library/media-library.repository.ts
git commit -m "feat(media-library): repository org-scoped com soft-delete

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `MediaLibraryService` (com testes)

Regras: org scoping em toda leitura/escrita, upload valida mime e delega ao `StorageService`, permissões de exclusão (dono ou ADMIN/OWNER).

**Files:**
- Create: `src/modules/media-library/media-library.service.ts`
- Test: `src/modules/media-library/media-library.service.spec.ts`

- [ ] **Step 1: Escrever os testes que falham**

Create `src/modules/media-library/media-library.service.spec.ts`:

```typescript
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { MediaLibraryService } from './media-library.service';

function makeFakeRepo() {
  const folders: any[] = [];
  const assets: any[] = [];
  let seq = 0;
  return {
    folders,
    assets,
    createFolder: jest.fn(async (data: any) => {
      const row = {
        id: `f${++seq}`,
        organizationId: data.organization.connect.id,
        name: data.name,
        createdById: data.createdById ?? null,
        deletedAt: null,
      };
      folders.push(row);
      return row;
    }),
    findFolders: jest.fn(async (orgId: string) =>
      folders.filter((f) => f.organizationId === orgId && !f.deletedAt),
    ),
    findFolderById: jest.fn(
      async (id: string) => folders.find((f) => f.id === id && !f.deletedAt) ?? null,
    ),
    softDeleteFolder: jest.fn(async (id: string) => {
      const f = folders.find((r) => r.id === id);
      f.deletedAt = new Date();
      return f;
    }),
    createAsset: jest.fn(async (data: any) => {
      const row = {
        id: `a${++seq}`,
        organizationId: data.organization.connect.id,
        folderId: data.folder?.connect?.id ?? null,
        uploadedById: data.uploadedById ?? null,
        url: data.url,
        storageKey: data.storageKey,
        mimeType: data.mimeType,
        size: data.size,
        filename: data.filename,
        title: data.title ?? null,
        deletedAt: null,
      };
      assets.push(row);
      return row;
    }),
    findAssets: jest.fn(async (orgId: string, folderId?: string) =>
      assets.filter(
        (a) =>
          a.organizationId === orgId &&
          !a.deletedAt &&
          (folderId ? a.folderId === folderId : true),
      ),
    ),
    findAssetById: jest.fn(
      async (id: string) => assets.find((a) => a.id === id && !a.deletedAt) ?? null,
    ),
    softDeleteAsset: jest.fn(async (id: string) => {
      const a = assets.find((r) => r.id === id);
      a.deletedAt = new Date();
      return a;
    }),
  };
}

function makeFakeStorage() {
  return {
    put: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
  };
}

function makeConfig(appUrl = 'https://api.example.com') {
  return { get: (k: string) => (k === 'APP_URL' ? appUrl : undefined) } as any;
}

function build() {
  const repo = makeFakeRepo();
  const storage = makeFakeStorage();
  const service = new MediaLibraryService(repo as any, storage as any, makeConfig());
  return { repo, storage, service };
}

const jpg = () => ({
  buffer: Buffer.from('img'),
  mimetype: 'image/jpeg',
  originalname: 'foto.jpg',
});

describe('MediaLibraryService', () => {
  describe('createFolder', () => {
    it('cria pasta ligada à org e ao criador', async () => {
      const { service, repo } = build();
      const folder = await service.createFolder('org1', 'user1', { name: 'Disney' });
      expect(folder.organizationId).toBe('org1');
      expect(folder.createdById).toBe('user1');
      expect(repo.createFolder).toHaveBeenCalled();
    });
  });

  describe('deleteFolder', () => {
    it('deixa o dono excluir', async () => {
      const { service } = build();
      const folder = await service.createFolder('org1', 'user1', { name: 'A' });
      await expect(
        service.deleteFolder(folder.id, 'org1', 'user1', OrgRole.AGENT),
      ).resolves.toBeDefined();
    });

    it('deixa ADMIN excluir pasta de outro', async () => {
      const { service } = build();
      const folder = await service.createFolder('org1', 'user1', { name: 'A' });
      await expect(
        service.deleteFolder(folder.id, 'org1', 'user2', OrgRole.ADMIN),
      ).resolves.toBeDefined();
    });

    it('bloqueia AGENT excluindo pasta de outro', async () => {
      const { service } = build();
      const folder = await service.createFolder('org1', 'user1', { name: 'A' });
      await expect(
        service.deleteFolder(folder.id, 'org1', 'user2', OrgRole.AGENT),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('não vê pasta de outra org (NotFound)', async () => {
      const { service } = build();
      const folder = await service.createFolder('org1', 'user1', { name: 'A' });
      await expect(
        service.deleteFolder(folder.id, 'orgOUTRA', 'user1', OrgRole.OWNER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('uploadAsset', () => {
    it('rejeita mime não suportado', async () => {
      const { service } = build();
      await expect(
        service.uploadAsset('org1', 'user1', {
          buffer: Buffer.from('x'),
          mimetype: 'application/x-msdownload',
          originalname: 'v.exe',
        }, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita arquivo vazio', async () => {
      const { service } = build();
      await expect(
        service.uploadAsset('org1', 'user1', {
          buffer: Buffer.alloc(0),
          mimetype: 'image/jpeg',
          originalname: 'v.jpg',
        }, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sobe imagem: grava no storage com key library/ e cria asset com storageKey e url pública', async () => {
      const { service, storage, repo } = build();
      const asset = await service.uploadAsset('org1', 'user1', jpg(), { title: 'Foto' });
      expect(storage.put).toHaveBeenCalledTimes(1);
      const [key, buf, contentType] = storage.put.mock.calls[0];
      expect(key).toMatch(/^library\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{32}\.jpg$/);
      expect(contentType).toBe('image/jpeg');
      expect(asset.storageKey).toBe(key);
      expect(asset.url).toBe(`https://api.example.com/api/v1/uploads/${key}`);
      expect(asset.uploadedById).toBe('user1');
      expect(asset.title).toBe('Foto');
      expect(repo.createAsset).toHaveBeenCalled();
    });

    it('aceita áudio (guarda como veio, sem transcodificar)', async () => {
      const { service, storage } = build();
      const asset = await service.uploadAsset('org1', 'user1', {
        buffer: Buffer.from('aud'),
        mimetype: 'audio/mpeg',
        originalname: 'boas-vindas.mp3',
      }, {});
      expect(asset.mimeType).toBe('audio/mpeg');
      const [key] = storage.put.mock.calls[0];
      expect(key).toMatch(/\.mp3$/);
    });

    it('valida que a pasta é da org antes de anexar', async () => {
      const { service } = build();
      const folder = await service.createFolder('org1', 'user1', { name: 'A' });
      await expect(
        service.uploadAsset('org1', 'user1', jpg(), { folderId: folder.id }),
      ).resolves.toBeDefined();
      await expect(
        service.uploadAsset('org2', 'user1', jpg(), { folderId: folder.id }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listAssets', () => {
    it('lista só assets da org', async () => {
      const { service } = build();
      await service.uploadAsset('org1', 'u', jpg(), {});
      await service.uploadAsset('org2', 'u', jpg(), {});
      const list = await service.listAssets('org1');
      expect(list).toHaveLength(1);
      expect(list[0].organizationId).toBe('org1');
    });
  });

  describe('deleteAsset', () => {
    it('dono exclui: remove do storage e soft-delete', async () => {
      const { service, storage } = build();
      const asset = await service.uploadAsset('org1', 'user1', jpg(), {});
      await service.deleteAsset(asset.id, 'org1', 'user1', OrgRole.AGENT);
      expect(storage.remove).toHaveBeenCalledWith(asset.storageKey);
    });

    it('bloqueia AGENT excluindo asset de outro', async () => {
      const { service } = build();
      const asset = await service.uploadAsset('org1', 'user1', jpg(), {});
      await expect(
        service.deleteAsset(asset.id, 'org1', 'user2', OrgRole.AGENT),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ADMIN exclui asset de outro', async () => {
      const { service, storage } = build();
      const asset = await service.uploadAsset('org1', 'user1', jpg(), {});
      await service.deleteAsset(asset.id, 'org1', 'user2', OrgRole.ADMIN);
      expect(storage.remove).toHaveBeenCalled();
    });

    it('asset de outra org é NotFound', async () => {
      const { service } = build();
      const asset = await service.uploadAsset('org1', 'user1', jpg(), {});
      await expect(
        service.deleteAsset(asset.id, 'orgOUTRA', 'user1', OrgRole.OWNER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd chat-bullq-api && npx jest src/modules/media-library/media-library.service.spec.ts`
Expected: FAIL — não consegue importar `MediaLibraryService`.

- [ ] **Step 3: Implementar o service**

Create `src/modules/media-library/media-library.service.ts`:

```typescript
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
      createdById: userId,
      organization: { connect: { id: orgId } },
    });
  }

  async listFolders(orgId: string) {
    return this.repository.findFolders(orgId);
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd chat-bullq-api && npx jest src/modules/media-library/media-library.service.spec.ts`
Expected: PASS (todos os testes).

- [ ] **Step 5: Commit**

```bash
cd chat-bullq-api
git add src/modules/media-library/media-library.service.ts src/modules/media-library/media-library.service.spec.ts
git commit -m "feat(media-library): service com upload, org scoping e permissões

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `MediaLibraryController`

Espelha `quick-replies.controller.ts`, mas usa `@CurrentUser('id')` e `@CurrentUserRole()` (para permissão de exclusão) e não restringe leitura/upload por `@Roles`.

**Files:**
- Create: `src/modules/media-library/media-library.controller.ts`

- [ ] **Step 1: Implementar o controller**

```typescript
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiConsumes, ApiQuery } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { MediaLibraryService } from './media-library.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UploadAssetDto } from './dto/upload-asset.dto';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser, CurrentUserRole } from '../../common/decorators';

@ApiTags('Media library')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('media-library')
export class MediaLibraryController {
  constructor(private readonly service: MediaLibraryService) {}

  // ----- folders -----
  @Get('folders')
  @ApiOperation({ summary: 'List folders' })
  listFolders(@CurrentOrg('id') orgId: string) {
    return this.service.listFolders(orgId);
  }

  @Post('folders')
  @ApiOperation({ summary: 'Create folder' })
  createFolder(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateFolderDto,
  ) {
    return this.service.createFolder(orgId, userId, dto);
  }

  @Delete('folders/:id')
  @ApiOperation({ summary: 'Delete folder (assets stay, unassigned)' })
  deleteFolder(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.deleteFolder(id, orgId, userId, role);
  }

  // ----- assets -----
  @Get('assets')
  @ApiOperation({ summary: 'List assets (optionally by folder)' })
  @ApiQuery({ name: 'folderId', required: false })
  listAssets(
    @CurrentOrg('id') orgId: string,
    @Query('folderId') folderId?: string,
  ) {
    return this.service.listAssets(orgId, folderId);
  }

  @Post('assets')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MediaLibraryService.MAX_BYTES },
    }),
  )
  @ApiOperation({ summary: 'Upload a file into the library' })
  @ApiConsumes('multipart/form-data')
  async uploadAsset(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UploadAssetDto,
    @UploadedFile()
    file?: { buffer: Buffer; mimetype: string; originalname?: string },
  ) {
    if (!file) throw new BadRequestException('file is required');
    return this.service.uploadAsset(orgId, userId, file, dto);
  }

  @Delete('assets/:id')
  @ApiOperation({ summary: 'Delete an asset (owner or admin)' })
  deleteAsset(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.deleteAsset(id, orgId, userId, role);
  }
}
```

- [ ] **Step 2: Confirmar compilação**

Run: `cd chat-bullq-api && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
cd chat-bullq-api
git add src/modules/media-library/media-library.controller.ts
git commit -m "feat(media-library): controller com rotas de pastas e assets

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `MediaLibraryModule` + registro no AppModule

`StorageService` é `@Global`, então basta injetá-lo; `ConfigModule` também é global.

**Files:**
- Create: `src/modules/media-library/media-library.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Criar o módulo**

```typescript
import { Module } from '@nestjs/common';
import { MediaLibraryController } from './media-library.controller';
import { MediaLibraryService } from './media-library.service';
import { MediaLibraryRepository } from './media-library.repository';

@Module({
  controllers: [MediaLibraryController],
  providers: [MediaLibraryRepository, MediaLibraryService],
  exports: [MediaLibraryService],
})
export class MediaLibraryModule {}
```

- [ ] **Step 2: Registrar no `app.module.ts`**

Adicione o import perto dos outros (ex. após a linha `import { QuickRepliesModule } ...`):

```typescript
import { MediaLibraryModule } from './modules/media-library/media-library.module';
```

E adicione `MediaLibraryModule` ao array `imports` do `@Module` (ex. logo após `QuickRepliesModule,`).

- [ ] **Step 3: Rodar a suíte e o boot check**

Run: `cd chat-bullq-api && npx jest src/modules/media-library && npx tsc --noEmit`
Expected: testes passam e sem erro de tipos.

- [ ] **Step 4: Commit**

```bash
cd chat-bullq-api
git add src/modules/media-library/media-library.module.ts src/app.module.ts
git commit -m "feat(media-library): registra o módulo no AppModule

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Web — service `media-library.service.ts`

Padrão axios do projeto: `api` já injeta `Authorization` + `x-organization-id`; respostas vêm no envelope `{ data }`.

**Files:**
- Create: `src/features/media-library/services/media-library.service.ts`

- [ ] **Step 1: Implementar o service**

```typescript
import { api } from '@/lib/api';

export interface MediaFolder {
  id: string;
  name: string;
  createdById: string | null;
}

export interface MediaAsset {
  id: string;
  folderId: string | null;
  uploadedById: string | null;
  url: string;
  mimeType: string;
  size: number;
  filename: string;
  title: string | null;
  createdAt: string;
}

export const mediaLibraryService = {
  async listFolders(): Promise<MediaFolder[]> {
    const { data } = await api.get('/media-library/folders');
    return data.data;
  },

  async createFolder(name: string): Promise<MediaFolder> {
    const { data } = await api.post('/media-library/folders', { name });
    return data.data;
  },

  async deleteFolder(id: string): Promise<void> {
    await api.delete(`/media-library/folders/${id}`);
  },

  async listAssets(folderId?: string): Promise<MediaAsset[]> {
    const { data } = await api.get('/media-library/assets', {
      params: folderId ? { folderId } : undefined,
    });
    return data.data;
  },

  async uploadAsset(
    file: File,
    opts?: { folderId?: string; title?: string },
  ): Promise<MediaAsset> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (opts?.folderId) form.append('folderId', opts.folderId);
    if (opts?.title) form.append('title', opts.title);
    const { data } = await api.post('/media-library/assets', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    });
    return data.data;
  },

  async deleteAsset(id: string): Promise<void> {
    await api.delete(`/media-library/assets/${id}`);
  },
};
```

- [ ] **Step 2: Commit**

```bash
cd chat-bullq-web
git add src/features/media-library/services/media-library.service.ts
git commit -m "feat(media-library): web service da biblioteca de arquivos

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Web — `inbox.service.sendLibraryMedia`

Enviar da biblioteca reusa `sendMessage` com a URL já hospedada, inferindo o tipo do mime (inclui AUDIO, ao contrário do `sendMediaMessage` do clipe).

**Files:**
- Modify: `src/features/inbox/services/inbox.service.ts` (adicionar método após `sendMediaMessage`, antes do `}` final do objeto)

- [ ] **Step 1: Adicionar o método e um tipo mínimo do asset**

No topo do arquivo (junto aos outros imports/tipos) não é necessário importar `MediaAsset`; o método aceita um shape estrutural para evitar acoplamento de import. Adicione dentro do objeto `inboxService`, logo após o método `sendMediaMessage`:

```typescript
  /**
   * Envia um arquivo já hospedado na Biblioteca de Arquivos (sem re-upload).
   * Infere IMAGE/VIDEO/AUDIO/DOCUMENT do mime — áudio da biblioteca vai como
   * type AUDIO (o clipe comum não trata áudio).
   */
  async sendLibraryMedia(
    conversationId: string,
    asset: { url: string; mimeType: string; size: number; filename: string },
  ): Promise<Message> {
    const mime = asset.mimeType || '';
    const type = mime.startsWith('image/')
      ? 'IMAGE'
      : mime.startsWith('video/')
        ? 'VIDEO'
        : mime.startsWith('audio/')
          ? 'AUDIO'
          : 'DOCUMENT';
    return this.sendMessage({
      conversationId,
      type,
      content: {
        mediaUrl: asset.url,
        mimeType: mime,
        fileSize: asset.size,
        fileName: asset.filename,
      },
    });
  },
```

- [ ] **Step 2: Confirmar type-check do web**

Run: `cd chat-bullq-web && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
cd chat-bullq-web
git add src/features/inbox/services/inbox.service.ts
git commit -m "feat(media-library): inbox.sendLibraryMedia (envia asset sem re-upload)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Web — `MediaLibraryDialog`

Modal manual (padrão `template-picker-dialog.tsx` / `proposal-dialog.tsx`): overlay fixo + painel `max-w-2xl max-h-[90vh]`, ESC + scroll-lock. Recebe `conversationId` e envia direto (como o `ProposalDialog`). Usa TanStack Query para pastas/assets.

**Files:**
- Create: `src/features/media-library/components/media-library-dialog.tsx`

- [ ] **Step 1: Implementar o modal**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Upload, FolderPlus, Trash2, Loader2, FileText, Music, Film, Search,
} from 'lucide-react';
import {
  mediaLibraryService,
  type MediaAsset,
  type MediaFolder,
} from '../services/media-library.service';
import { inboxService } from '@/features/inbox/services/inbox.service';

interface Props {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MediaLibraryDialog({ conversationId, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [folderId, setFolderId] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onOpenChange(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onOpenChange]);

  const folders = useQuery({
    queryKey: ['media-library', 'folders'],
    queryFn: () => mediaLibraryService.listFolders(),
    enabled: open,
  });

  const assets = useQuery({
    queryKey: ['media-library', 'assets', folderId ?? 'all'],
    queryFn: () => mediaLibraryService.listAssets(folderId),
    enabled: open,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['media-library'] });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      await mediaLibraryService.uploadAsset(file, { folderId });
      await invalidate();
      toast.success('Arquivo adicionado à biblioteca');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao enviar arquivo');
    } finally {
      setUploading(false);
    }
  };

  const handleNewFolder = async () => {
    const name = window.prompt('Nome da nova pasta:')?.trim();
    if (!name) return;
    try {
      await mediaLibraryService.createFolder(name);
      await invalidate();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao criar pasta');
    }
  };

  const handleDeleteAsset = async (asset: MediaAsset) => {
    if (!window.confirm(`Excluir "${asset.title || asset.filename}" da biblioteca?`)) return;
    try {
      await mediaLibraryService.deleteAsset(asset.id);
      await invalidate();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Sem permissão para excluir');
    }
  };

  const handleSend = async (asset: MediaAsset) => {
    setSendingId(asset.id);
    try {
      await inboxService.sendLibraryMedia(conversationId, asset);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao enviar');
    } finally {
      setSendingId(null);
    }
  };

  if (!open) return null;

  const list = (assets.data ?? []).filter((a) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (a.title || a.filename).toLowerCase().includes(q);
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Biblioteca de arquivos
          </h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* toolbar: pastas + ações */}
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-5 py-2.5 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFolderId(undefined)}
              className={chip(folderId === undefined)}
            >
              Todos
            </button>
            {(folders.data ?? []).map((f: MediaFolder) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFolderId(f.id)}
                className={chip(folderId === f.id)}
              >
                {f.name}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleNewFolder}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <FolderPlus className="h-4 w-4" /> Nova pasta
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Enviar arquivo
            </button>
            <input ref={fileRef} type="file" onChange={handleUpload} className="hidden" />
          </div>
        </div>

        {/* busca */}
        <div className="border-b border-zinc-200 px-5 py-2 dark:border-zinc-800">
          <div className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5 dark:border-zinc-800">
            <Search className="h-4 w-4 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
            />
          </div>
        </div>

        {/* grid */}
        <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto p-5 sm:grid-cols-3">
          {assets.isLoading && (
            <p className="col-span-full py-8 text-center text-sm text-zinc-500">Carregando…</p>
          )}
          {!assets.isLoading && list.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-zinc-500">
              Nenhum arquivo aqui ainda. Clique em “Enviar arquivo”.
            </p>
          )}
          {list.map((asset) => (
            <div
              key={asset.id}
              className="group relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
            >
              <button
                type="button"
                onClick={() => handleSend(asset)}
                disabled={sendingId === asset.id}
                className="flex w-full flex-col text-left"
                title="Enviar para o cliente"
              >
                <div className="flex h-28 items-center justify-center bg-zinc-100 dark:bg-zinc-900">
                  {asset.mimeType.startsWith('image/') ? (
                    <img src={asset.url} alt={asset.filename} className="h-full w-full object-cover" />
                  ) : (
                    <AssetIcon mime={asset.mimeType} />
                  )}
                </div>
                <div className="truncate px-2 py-1.5 text-xs text-zinc-700 dark:text-zinc-300">
                  {asset.title || asset.filename}
                </div>
              </button>
              {sendingId === asset.id && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-black/60">
                  <Loader2 className="h-5 w-5 animate-spin text-violet-600" />
                </div>
              )}
              <button
                type="button"
                onClick={() => handleDeleteAsset(asset)}
                className="absolute right-1.5 top-1.5 rounded-md bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-600"
                aria-label="Excluir arquivo"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function chip(active: boolean): string {
  return [
    'rounded-full px-3 py-1 text-xs font-medium transition-colors',
    active
      ? 'bg-violet-600 text-white'
      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700',
  ].join(' ');
}

function AssetIcon({ mime }: { mime: string }) {
  const cls = 'h-8 w-8 text-zinc-400';
  if (mime.startsWith('audio/')) return <Music className={cls} />;
  if (mime.startsWith('video/')) return <Film className={cls} />;
  return <FileText className={cls} />;
}
```

- [ ] **Step 2: Confirmar type-check**

Run: `cd chat-bullq-web && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
cd chat-bullq-web
git add src/features/media-library/components/media-library-dialog.tsx
git commit -m "feat(media-library): modal da biblioteca (pastas, grid, upload, enviar)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Web — chooser de origem no clipe do compositor

O botão do clipe passa a abrir um `Dropdown` com **Do meu dispositivo** (fluxo atual) e **Biblioteca de arquivos** (abre o modal). Mantém o estado `isSendingFile` e o `<input type="file">` existentes.

**Files:**
- Modify: `src/features/inbox/components/chat-input.tsx`

- [ ] **Step 1: Adicionar imports**

No bloco de imports de ícones (`lucide-react`), acrescente `FolderOpen` e `Smartphone`. Após o import do `ProposalDialog`, adicione o Dropdown e o modal da biblioteca:

```tsx
import {
  Dropdown,
  DropdownButton,
  DropdownItem,
  DropdownMenu,
} from '@/components/ui/dropdown';
import { MediaLibraryDialog } from '@/features/media-library/components/media-library-dialog';
```

E no import do `lucide-react`, some `FolderOpen, Smartphone` à lista existente.

- [ ] **Step 2: Adicionar estado do modal**

Junto aos outros `useState` (perto de `proposalOpen`):

```tsx
  const [libraryOpen, setLibraryOpen] = useState(false);
```

- [ ] **Step 3: Substituir o botão do clipe por um Dropdown**

Troque o bloco atual do botão de anexar (o `<button ... aria-label="Anexar arquivo">…</button>`, logo após o `<input ref={fileInputRef} .../>`) por:

```tsx
        <Dropdown>
          <DropdownButton
            as="button"
            type="button"
            disabled={!onSendFile || isSendingFile}
            className="mb-0.5 flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 lg:mb-1 lg:h-auto lg:w-auto lg:p-2"
            aria-label="Anexar arquivo"
          >
            {isSendingFile ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Paperclip className="h-5 w-5" />
            )}
          </DropdownButton>
          <DropdownMenu anchor="top start">
            <DropdownItem onClick={() => fileInputRef.current?.click()}>
              <Smartphone /> Do meu dispositivo
            </DropdownItem>
            {conversationId && (
              <DropdownItem onClick={() => setLibraryOpen(true)}>
                <FolderOpen /> Biblioteca de arquivos
              </DropdownItem>
            )}
          </DropdownMenu>
        </Dropdown>
```

- [ ] **Step 4: Renderizar o modal da biblioteca**

Junto aos outros modais no fim do JSX (após o bloco `<ProposalDialog .../>`):

```tsx
      {conversationId && (
        <MediaLibraryDialog
          conversationId={conversationId}
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
        />
      )}
```

- [ ] **Step 5: Type-check e lint**

Run: `cd chat-bullq-web && npx tsc --noEmit`
Expected: sem erros. (O `<input type="file">` continua existindo e é acionado pelo item “Do meu dispositivo”.)

- [ ] **Step 6: Commit**

```bash
cd chat-bullq-web
git add src/features/inbox/components/chat-input.tsx
git commit -m "feat(media-library): clipe pergunta origem (dispositivo vs biblioteca)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Verificação end-to-end (manual)

- [ ] **Step 1: Subir API + Web local**

Run (API): `cd chat-bullq-api && npm run start:dev`
Run (Web): `cd chat-bullq-web && npm run dev`
(Login de teste conforme ambiente; API na 3001, web na 3000.)

- [ ] **Step 2: Roteiro de teste na Inbox**

Abra uma conversa e valide:
1. Clicar no clipe → aparece menu **Do meu dispositivo** / **Biblioteca de arquivos**.
2. **Do meu dispositivo** → seleção de arquivo → envia como hoje (comportamento inalterado).
3. **Biblioteca** → modal abre. Criar pasta “Disney”. Enviar uma imagem para a biblioteca → aparece no grid.
4. Filtrar pela pasta; buscar por nome.
5. Clicar numa imagem do grid → é enviada ao cliente e o modal fecha; a bolha de imagem aparece na conversa.
6. Subir um MP3 → enviar da biblioteca → chega como áudio.
7. Excluir um arquivo que você subiu → some do grid. (Como AGENT, tentar excluir arquivo de outro → toast “Sem permissão”.)

- [ ] **Step 3: Rodar toda a suíte de testes do backend**

Run: `cd chat-bullq-api && npx jest src/modules/media-library src/modules/storage`
Expected: PASS.

---

## Self-Review (preenchido pelo autor do plano)

- **Cobertura do spec:** modelos (T1), storage.remove p/ exclusão (T2), DTOs (T3), repository org-scoped+soft-delete (T4), service com upload/permissões/org scoping (T5), rotas guardadas (T6), registro (T7), web service (T8), envio sem re-upload incl. áudio (T9), modal com pastas/grid/upload/criar-pasta/excluir/buscar (T10), chooser de origem no clipe (T11), E2E (T12). Tudo do design coberto.
- **Sem placeholders:** todo passo com código traz o código completo; comandos com saída esperada.
- **Consistência de tipos:** `MediaLibraryService.MAX_BYTES` usado no controller (T6) casa com a constante definida em T5; `uploadAsset(orgId, userId, file, dto)`, `deleteAsset(id, orgId, userId, role)`, `deleteFolder(id, orgId, userId, role)` idênticos entre service (T5), testes (T5) e controller (T6); `sendLibraryMedia(conversationId, asset)` (T9) casa com o uso no modal (T10); `mediaLibraryService` métodos (T8) casam com o modal (T10).
- **Escopo:** uma fatia deployável, 1 migração, sem novas env vars (reusa MINIO_*/APP_URL).
```
