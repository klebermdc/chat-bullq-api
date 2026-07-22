import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NotificationType, OrgRole } from '@prisma/client';
import { NotificationsRepository } from './notifications.repository';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly prisma: PrismaService,
    @InjectQueue('notifications') private readonly notifQueue: Queue,
  ) {}

  async notify(params: {
    recipientId: string;
    organizationId: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, any>;
  }) {
    const notification = await this.repository.create({
      recipientId: params.recipientId,
      organizationId: params.organizationId,
      type: params.type,
      title: params.title,
      body: params.body,
      data: params.data || {},
    });

    await this.notifQueue.add('deliver', {
      notificationId: notification.id,
      recipientId: params.recipientId,
      organizationId: params.organizationId,
      type: params.type,
      title: params.title,
      body: params.body,
      data: params.data,
    });

    return notification;
  }

  /**
   * Notifica membros da org. Por padrão vai pra todo mundo — é o que
   * alertas operacionais (SLA, watchdog, transição de cadência) precisam:
   * quem atende tem que ver.
   *
   * `roles` restringe a papéis específicos. Existe pros alertas TÉCNICOS
   * (falha de skill da IA, webhook morrendo), que só quem administra pode
   * resolver. Mandar isso pro atendente não gera ação — gera ruído, e ruído
   * treina a equipe a ignorar o sino, inclusive quando o alerta importa.
   */
  async notifyOrgAgents(params: {
    organizationId: string;
    excludeUserId?: string;
    roles?: OrgRole[];
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, any>;
  }) {
    const members = await this.prisma.userOrganization.findMany({
      where: {
        organizationId: params.organizationId,
        ...(params.roles?.length ? { role: { in: params.roles } } : {}),
      },
      select: { userId: true },
    });

    const recipients = members
      .map((m) => m.userId)
      .filter((id) => id !== params.excludeUserId);

    for (const recipientId of recipients) {
      await this.notify({
        recipientId,
        organizationId: params.organizationId,
        type: params.type,
        title: params.title,
        body: params.body,
        data: params.data,
      });
    }
  }

  async findByUser(userId: string, orgId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const { notifications, total } = await this.repository.findByUser(userId, orgId, skip, limit);
    const unreadCount = await this.repository.countUnread(userId, orgId);
    return {
      notifications,
      unreadCount,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async markRead(id: string) {
    return this.repository.markRead(id);
  }

  async markAllRead(userId: string, orgId: string) {
    return this.repository.markAllRead(userId, orgId);
  }

  async getUnreadCount(userId: string, orgId: string) {
    return this.repository.countUnread(userId, orgId);
  }
}
