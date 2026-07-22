import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, NotificationType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.NotificationUncheckedCreateInput) {
    return this.prisma.notification.create({ data });
  }

  async findByUser(userId: string, orgId: string, skip: number, take: number) {
    const [notifications, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { recipientId: userId, organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notification.count({
        where: { recipientId: userId, organizationId: orgId },
      }),
    ]);
    return { notifications, total };
  }

  async countUnread(userId: string, orgId: string) {
    return this.prisma.notification.count({
      where: { recipientId: userId, organizationId: orgId, isRead: false },
    });
  }

  /**
   * Antes desta checagem, `markRead` operava só por `id` (chave primária)
   * sem validar `recipientId`/`organizationId` — qualquer usuário
   * autenticado de QUALQUER org conseguia marcar como lida a notificação de
   * outro usuário/org só sabendo (ou adivinhando) o id. É o único ponto do
   * módulo sem checagem de tenancy; impacto é baixo (só flips isRead/readAt,
   * não vaza conteúdo), mas fecha aqui mesmo assim.
   */
  async markRead(id: string, recipientId: string, organizationId: string) {
    const owned = await this.prisma.notification.findFirst({
      where: { id, recipientId, organizationId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Notification not found');
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string, orgId: string) {
    return this.prisma.notification.updateMany({
      where: { recipientId: userId, organizationId: orgId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }
}
