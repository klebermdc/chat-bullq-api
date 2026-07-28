import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

/**
 * Garante que a figurinha que vai sair é um arquivo da própria organização.
 *
 * Sem isto, `content.mediaUrl` é uma string livre que o service repassa direto
 * ao provedor: daria para mandar a URL de um asset de OUTRA organização (ou uma
 * URL interna qualquer) e o WhatsApp buscaria esse conteúdo. Este projeto não
 * tem RLS — a barreira de tenant é o `organizationId` no where, e só.
 */
export async function assertStickerAllowed(
  prisma: PrismaService,
  organizationId: string,
  content: Record<string, any>,
): Promise<void> {
  const mediaUrl = content?.mediaUrl;
  if (typeof mediaUrl !== 'string' || !mediaUrl.trim()) {
    throw new BadRequestException('Figurinha exige content.mediaUrl');
  }

  const asset = await prisma.mediaAsset.findFirst({
    where: { url: mediaUrl, organizationId, deletedAt: null },
    select: { id: true, mimeType: true },
  });

  if (!asset) {
    throw new ForbiddenException(
      'Esta figurinha não pertence à sua organização',
    );
  }

  if (asset.mimeType !== 'image/webp') {
    throw new BadRequestException(
      'Figurinha precisa ser .webp — o WhatsApp rejeita outros formatos',
    );
  }
}
