import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { assertStickerAllowed } from './sticker-guard';

describe('assertStickerAllowed', () => {
  const orgId = 'org-1';

  function prismaWith(asset: unknown) {
    return {
      mediaAsset: { findFirst: jest.fn().mockResolvedValue(asset) },
    } as any;
  }

  it('aceita figurinha cujo asset é da própria organização', async () => {
    const prisma = prismaWith({ id: 'a1', mimeType: 'image/webp' });

    await expect(
      assertStickerAllowed(prisma, orgId, { mediaUrl: 'https://x/y.webp' }),
    ).resolves.toBeUndefined();

    expect(prisma.mediaAsset.findFirst).toHaveBeenCalledWith({
      where: { url: 'https://x/y.webp', organizationId: orgId, deletedAt: null },
      select: { id: true, mimeType: true },
    });
  });

  it('recusa quando não existe asset com aquela url na organização', async () => {
    const prisma = prismaWith(null);

    await expect(
      assertStickerAllowed(prisma, orgId, { mediaUrl: 'https://evil/x.webp' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recusa quando falta mediaUrl', async () => {
    const prisma = prismaWith(null);

    await expect(
      assertStickerAllowed(prisma, orgId, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa mediaUrl vazia ou só espaços', async () => {
    const prisma = prismaWith(null);

    await expect(
      assertStickerAllowed(prisma, orgId, { mediaUrl: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.mediaAsset.findFirst).not.toHaveBeenCalled();
  });

  it('recusa asset que não é webp — WhatsApp só aceita webp como figurinha', async () => {
    const prisma = prismaWith({ id: 'a1', mimeType: 'image/png' });

    await expect(
      assertStickerAllowed(prisma, orgId, { mediaUrl: 'https://x/y.png' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
