import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { PrismaModule } from '../../database/prisma.module';
import { LlmModule } from '../ai-agents/llm/llm.module';
import { OrderRelevanceService } from './order-relevance.service';
import { OrderExtractorService } from './order-extractor.service';
import { OrderFichaRepository } from './order-ficha.repository';
import { ConversationMessagesReader } from './conversation-messages.reader';
import { OrderFichaService } from './order-ficha.service';
import { OrderFichaProcessor, ORDER_FICHA_QUEUE } from './order-ficha.processor';

/**
 * Módulo da Ficha do Pedido.
 *
 * Registra a fila BullMQ `order-ficha` e seu worker, que enfileira o
 * orquestrador (gate de relevância + extrator grounded + upsert) depois de
 * cada mensagem inbound do cliente. Exporta `BullModule` (padrão espelhado
 * de `LongTermMemoryModule`) para que qualquer módulo que importe
 * `OrderFichaModule` consiga `@InjectQueue(ORDER_FICHA_QUEUE)` nos próprios
 * providers — é assim que o `InboundMessageProcessor` (em `MessagingModule`)
 * enfileira o job sem precisar de outro `registerQueue` duplicado.
 */
@Module({
  imports: [
    PrismaModule,
    LlmModule,
    BullModule.registerQueue({ name: ORDER_FICHA_QUEUE }),
  ],
  providers: [
    OrderFichaRepository,
    OrderRelevanceService,
    OrderExtractorService,
    ConversationMessagesReader,
    OrderFichaService,
    OrderFichaProcessor,
  ],
  exports: [OrderFichaService, OrderFichaRepository, BullModule],
})
export class OrderFichaModule {}
