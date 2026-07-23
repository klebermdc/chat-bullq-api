import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { PrismaService } from '../../../database/prisma.service';
import { KnowledgeExtractorService } from './knowledge-extractor.service';
import { KnowledgeService } from './knowledge.service';
import {
  KNOWLEDGE_EXTRACTOR_QUEUE,
  KnowledgeExtractorJobData,
  KnowledgeMessage,
} from './knowledge.types';

/**
 * Worker BullMQ do aprendizado em modo SHADOW: depois que uma conversa de
 * atendimento (guiamento em parques) avança, este processor puxa a janela
 * recente, mapeia os papéis (cliente/atendente), pede ao extrator o que dá
 * pra aprender e persiste os itens de conhecimento coletivo.
 *
 * Molde: memory/long-term/memory-extractor.processor.ts. Concorrência baixa
 * de propósito — extração é async e fora do caminho crítico da resposta.
 */
@Processor(KNOWLEDGE_EXTRACTOR_QUEUE, { concurrency: 2 })
export class KnowledgeExtractorProcessor extends WorkerHost {
  private readonly logger = new Logger(KnowledgeExtractorProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extractor: KnowledgeExtractorService,
    private readonly knowledge: KnowledgeService,
  ) {
    super();
  }

  async process(job: Job<KnowledgeExtractorJobData>): Promise<void> {
    const { organizationId, agentId, conversationId } = job.data;

    // Últimas 30 mensagens (mais recentes primeiro), depois reverte pra
    // ordem cronológica — igual ao molde memory-extractor.processor.
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    if (rows.length === 0) {
      this.logger.debug(
        `knowledge_skip conv=${conversationId} — sem mensagens`,
      );
      return;
    }

    const messages: KnowledgeMessage[] = rows
      .slice()
      .reverse()
      .map((m) => ({
        role: (m.direction === 'INBOUND' ? 'customer' : 'operator') as
          | 'customer'
          | 'operator',
        content: this.extractMessageText(m.content),
        createdAt: m.createdAt.toISOString(),
      }))
      .filter((m) => m.content.trim().length > 0);

    if (messages.length === 0) {
      this.logger.debug(
        `knowledge_skip conv=${conversationId} — sem conteúdo textual`,
      );
      return;
    }

    const result = await this.extractor.extract({
      organizationId,
      agentId,
      conversationId,
      messages,
    });

    if (result.items.length === 0) return;

    await this.knowledge.recordItems(organizationId, agentId, result.items, {
      conversationId,
    });
    this.logger.debug(
      `knowledge_extracted conv=${conversationId} items=${result.items.length}`,
    );
  }

  /**
   * Message.content é coluna Json — `{ text, ... }` pra mensagens de TEXTO e
   * shapes específicos por provider pra mídia. Devolvemos o corpo textual
   * quando presente. Molde: memory-extractor.processor.extractMessageText.
   */
  private extractMessageText(content: unknown): string {
    if (!content || typeof content !== 'object') return '';
    const c = content as Record<string, unknown>;
    if (typeof c.text === 'string') return c.text;
    if (typeof c.body === 'string') return c.body;
    if (typeof c.caption === 'string') return c.caption;
    return '';
  }
}
