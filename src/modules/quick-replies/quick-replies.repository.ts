import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const OWNER_INCLUDE = { owner: { select: { id: true, name: true } } } as const;

@Injectable()
export class QuickRepliesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.QuickReplyCreateInput) {
    return this.prisma.quickReply.create({ data, include: OWNER_INCLUDE });
  }

  /**
   * `viewerUserId` nulo = enxerga tudo (dono/admin). Preenchido = só as da
   * equipe (sem dono) e as do próprio vendedor.
   */
  async findVisible(organizationId: string, viewerUserId: string | null) {
    return this.prisma.quickReply.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(viewerUserId !== null && { OR: [{ ownerUserId: null }, { ownerUserId: viewerUserId }] }),
      },
      include: OWNER_INCLUDE,
      orderBy: { shortcut: 'asc' },
    });
  }

  async findById(id: string) {
    return this.prisma.quickReply.findFirst({
      where: { id, deletedAt: null },
      include: OWNER_INCLUDE,
    });
  }

  async isMember(organizationId: string, userId: string): Promise<boolean> {
    const membership = await this.prisma.userOrganization.findFirst({
      where: { organizationId, userId },
      select: { id: true },
    });
    return membership !== null;
  }

  async findByShortcut(organizationId: string, shortcut: string) {
    return this.prisma.quickReply.findFirst({
      where: { organizationId, shortcut, deletedAt: null },
    });
  }

  async update(id: string, data: Prisma.QuickReplyUpdateInput) {
    return this.prisma.quickReply.update({ where: { id }, data, include: OWNER_INCLUDE });
  }

  /**
   * O índice único (org, atalho) não olha `deletedAt`: renomeia o atalho da
   * apagada pra ele poder ser cadastrado de novo (senão recriar dava 500).
   */
  async softDelete(id: string, shortcut: string) {
    return this.prisma.quickReply.update({
      where: { id },
      data: { deletedAt: new Date(), shortcut: `${shortcut}~apagado~${id}` },
    });
  }
}
