import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../database/prisma.service';
import { KNOWLEDGE_EXTRACTOR_QUEUE } from './knowledge.types';

@Injectable()
export class HistoryScanService {
  private readonly logger = new Logger(HistoryScanService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(KNOWLEDGE_EXTRACTOR_QUEUE) private readonly queue: Queue,
  ) {}

  async scan(organizationId: string, agentId: string): Promise<{ enqueued: number }> {
    const assignment = await this.prisma.aiAgentChannel.findFirst({
      where: { agentId, mode: 'SHADOW' },
      select: { tagFilterId: true },
    });
    if (!assignment) return { enqueued: 0 };

    const where: any = { organizationId };
    if (assignment.tagFilterId) {
      where.tags = { some: { tagId: assignment.tagFilterId } };
    }

    const conversations = await this.prisma.conversation.findMany({
      where,
      select: { id: true },
      take: 2000,
    });

    for (const conv of conversations) {
      await this.queue.add(
        'extract_knowledge',
        { organizationId, agentId, conversationId: conv.id },
        { removeOnComplete: 100, removeOnFail: 50 },
      );
    }

    this.logger.log(`history_scan org=${organizationId} agent=${agentId} enqueued=${conversations.length}`);
    return { enqueued: conversations.length };
  }
}
