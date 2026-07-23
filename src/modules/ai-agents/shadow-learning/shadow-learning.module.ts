import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { PrismaModule } from '../../../database/prisma.module';
import { LlmModule } from '../llm/llm.module';
import { RagModule } from '../rag/rag.module';
import { KNOWLEDGE_EXTRACTOR_QUEUE } from './knowledge.types';
import { KnowledgeExtractorService } from './knowledge-extractor.service';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeExtractorProcessor } from './knowledge-extractor.processor';
import { ShadowObserverService } from './shadow-observer.service';
import { HistoryScanService } from './history-scan.service';
import { KnowledgeController } from './knowledge.controller';

/**
 * Shadow-learning module.
 *
 * Observa conversas humanas (shadow mode), extrai conhecimento com LLM e
 * indexa no vetor RAG para alimentar as respostas do agente-guia.
 *
 * Wiring das dependências:
 *   - `PrismaModule`  — PrismaService (global, importado por clareza)
 *   - `LlmModule`     — exporta `LlmService` (KnowledgeExtractorService)
 *   - `RagModule`     — exporta `EmbeddingsService`, `VectorStoreService` e a
 *                       registração da queue `rag-indexer`, que o
 *                       `KnowledgeService` injeta via @InjectQueue('rag-indexer')
 *   - `BullModule.registerQueue({ name: KNOWLEDGE_EXTRACTOR_QUEUE })` — queue
 *                       `knowledge-extractor` para o processor + os produtores
 *                       (ShadowObserverService / HistoryScanService)
 *
 * Exporta `ShadowObserverService` para que o pipeline de mensagens (Task 12,
 * via AiAgentsModule) consiga observar as conversas.
 */
@Module({
  imports: [
    PrismaModule,
    LlmModule,
    RagModule,
    BullModule.registerQueue({ name: KNOWLEDGE_EXTRACTOR_QUEUE }),
  ],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeExtractorService,
    KnowledgeService,
    KnowledgeExtractorProcessor,
    ShadowObserverService,
    HistoryScanService,
  ],
  exports: [ShadowObserverService],
})
export class ShadowLearningModule {}
