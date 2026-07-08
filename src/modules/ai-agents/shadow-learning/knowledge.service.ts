import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { EmbeddingsService } from '../rag/embeddings.service';
import { VectorStoreService } from '../rag/vector-store.service';
import { KnowledgeItem } from './knowledge.types';

/** Acima disso, consideramos que o item já existe (reforço, não novo). */
const DEDUPE_MIN_SCORE = 0.9;

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
    private readonly store: VectorStoreService,
    @InjectQueue('rag-indexer') private readonly ragQueue: Queue,
  ) {}

  /**
   * Para cada item destilado: embeda, busca similar no RAG (escopo agentId,
   * ownerType 'procedure', k=1, minScore alto). Se houver hit → reforça o
   * registro existente (occurrences++). Caso contrário → cria novo e enfileira
   * a indexação (`index_procedure`) para o item entrar no RAG do agente.
   */
  async recordItems(
    organizationId: string,
    agentId: string,
    items: KnowledgeItem[],
    source: { conversationId: string },
  ): Promise<void> {
    for (const item of items) {
      const { vector } = await this.embeddings.embed(item.content, organizationId);
      const hits = await this.store.search(
        vector,
        { agentId, ownerType: 'procedure' },
        1,
        DEDUPE_MIN_SCORE,
      );

      if (hits.length > 0) {
        // `SearchResult` aninha `ownerId` dentro de `entry` (rag/types.ts).
        // Para 'procedure', ownerId === id da linha ai_agent_knowledge.
        const knowledgeId = hits[0].entry.ownerId;
        // sourceExamples é coluna Json — o operador `{ push }` do Prisma só
        // funciona em colunas de LISTA escalar, então NÃO o usamos aqui.
        // Basta reforçar o contador de ocorrências.
        await this.prisma.aiAgentKnowledge.update({
          where: { id: knowledgeId },
          data: { occurrences: { increment: 1 } },
        });
        this.logger.log(
          `knowledge_reinforced id=${knowledgeId} agentId=${agentId} conversationId=${source.conversationId}`,
        );
        continue;
      }

      const created = await this.prisma.aiAgentKnowledge.create({
        data: {
          organizationId,
          agentId,
          kind: item.kind,
          category: item.category,
          content: item.content,
          question: item.question ?? null,
          confidence: item.confidence ?? 0.8,
          sourceExamples: [source.conversationId] as Prisma.InputJsonValue,
        },
      });

      await this.ragQueue.add(
        'index_procedure',
        {
          type: 'index_procedure',
          knowledgeId: created.id,
          content: item.content,
          organizationId,
          agentId,
        },
        { removeOnComplete: 200, removeOnFail: 50 },
      );

      this.logger.log(
        `knowledge_created id=${created.id} agentId=${agentId} kind=${item.kind} category=${item.category}`,
      );
    }
  }

  /** Relatório: conhecimento do agente ordenado por recorrência (desc). */
  list(organizationId: string, agentId: string) {
    return this.prisma.aiAgentKnowledge.findMany({
      where: { organizationId, agentId },
      orderBy: { occurrences: 'desc' },
    });
  }
}
