import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import {
  ALL_ORIGIN_TAG_NAMES,
  LeadOriginKey,
  ORIGIN_TAG_NAMES,
} from './lead-origin.constants';

/** Escolha de origem aceita pela correção manual. WHATSAPP_DIRECT = sem tag (fallback). */
export type LeadOriginChoice = LeadOriginKey | 'WHATSAPP_DIRECT';

/**
 * Define a ORIGEM de um lead de forma single-valued: no máximo uma tag de origem
 * por conversa. Idempotente (remove as de origem e reaplica a escolhida).
 * Escreve direto no Prisma para NÃO disparar automações de tag (mirrors
 * LeadSourceTaggerService — não usa TagsService).
 */
@Injectable()
export class LeadOriginService {
  constructor(private readonly prisma: PrismaService) {}

  async setOrigin(
    organizationId: string,
    conversationId: string,
    origin: LeadOriginChoice,
  ): Promise<{ tags: { id: string; name: string }[] }> {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
      select: { id: true },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    const desiredName =
      origin === 'WHATSAPP_DIRECT' ? undefined : ORIGIN_TAG_NAMES[origin];

    // Atômico: limpar as tags de origem e (re)aplicar a escolhida numa transação,
    // senão duas correções concorrentes (double-click, retry) podem intercalar o
    // read→delete→create e deixar a origem errada ou vazia (invariante single-valued).
    return this.prisma.$transaction(async (tx) => {
      // Tags de origem que EXISTEM nesta org (para saber o que limpar).
      const originTags = await tx.tag.findMany({
        where: { organizationId, name: { in: ALL_ORIGIN_TAG_NAMES } },
        select: { id: true, name: true },
      });
      const originTagIds = originTags.map((t) => t.id);

      if (originTagIds.length) {
        await tx.conversationTag.deleteMany({
          where: { conversationId, tagId: { in: originTagIds } },
        });
      }

      if (desiredName) {
        const tag = await tx.tag.upsert({
          where: { organizationId_name: { organizationId, name: desiredName } },
          update: {},
          create: { organizationId, name: desiredName },
          select: { id: true, name: true },
        });
        await tx.conversationTag.create({
          data: { conversationId, tagId: tag.id },
        });
        return { tags: [{ id: tag.id, name: tag.name }] };
      }

      return { tags: [] };
    });
  }
}
