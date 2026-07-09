import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../database/prisma.service';
import { KNOWLEDGE_EXTRACTOR_QUEUE } from './knowledge.types';

@Injectable()
export class ShadowObserverService {
  private readonly logger = new Logger(ShadowObserverService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(KNOWLEDGE_EXTRACTOR_QUEUE) private readonly queue: Queue,
  ) {}

  async observe(conversationId: string): Promise<void> {
    try {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: {
          id: true,
          organizationId: true,
          channelId: true,
          contactId: true,
          tags: { select: { tagId: true } },
        },
      });
      if (!conv) return;

      const shadowAssignments = await this.prisma.aiAgentChannel.findMany({
        where: { channelId: conv.channelId, mode: 'SHADOW' },
        select: { agentId: true, tagFilterId: true },
      });
      if (shadowAssignments.length === 0) return;

      const convTagIds = new Set(conv.tags.map((t) => t.tagId));
      let contactTagIds: Set<string> | null = null;

      for (const a of shadowAssignments) {
        if (a.tagFilterId) {
          let matches = convTagIds.has(a.tagFilterId);
          if (!matches) {
            if (contactTagIds === null) {
              const ct = await this.prisma.contactTag.findMany({
                where: { contactId: conv.contactId },
                select: { tagId: true },
              });
              contactTagIds = new Set(ct.map((x) => x.tagId));
            }
            matches = contactTagIds.has(a.tagFilterId);
          }
          if (!matches) continue;
        }

        await this.queue.add(
          'extract_knowledge',
          { organizationId: conv.organizationId, agentId: a.agentId, conversationId: conv.id },
          { removeOnComplete: 100, removeOnFail: 50 },
        );
      }
    } catch (err) {
      this.logger.warn(`shadow_observe_failed conv=${conversationId}: ${(err as Error).message}`);
    }
  }
}
