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
      const [key, buf, contentType] = storage.put.mock.calls[0] as any[];
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
      const [key] = storage.put.mock.calls[0] as any[];
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
