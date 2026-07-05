import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class PublicAiAgentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    return this.prisma.aiAgent.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
      include: { channels: { include: { channel: { select: { id: true, name: true, type: true } } } } },
    });
  }

  async findOne(organizationId: string, id: string) {
    const agent = await this.prisma.aiAgent.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: { channels: { include: { channel: { select: { id: true, name: true, type: true } } } } },
    });
    if (!agent) throw new NotFoundException('AI agent not found');
    return agent;
  }

  async listRuns(organizationId: string, agentId: string, limit: number) {
    await this.findOne(organizationId, agentId);
    return this.prisma.aiAgentRun.findMany({
      where: { agentId, organizationId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: { _count: { select: { toolCalls: true } } },
    });
  }
}
