import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class ActivityLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    organizationId: string,
    filters: { conversationId?: string; actorId?: string; action?: string; from?: Date; to?: Date },
    page: number,
    limit: number,
  ) {
    const where: Prisma.ConversationAuditLogWhereInput = {
      conversation: { organizationId },
      ...(filters.conversationId ? { conversationId: filters.conversationId } : {}),
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.from || filters.to
        ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
        : {}),
    };
    const skip = (page - 1) * limit;
    const [logs, total] = await this.prisma.$transaction([
      this.prisma.conversationAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      this.prisma.conversationAuditLog.count({ where }),
    ]);
    return { logs, total };
  }
}
