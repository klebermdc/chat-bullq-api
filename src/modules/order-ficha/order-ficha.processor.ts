import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { OrderFichaService, IngestInput } from './order-ficha.service';

/** Queue name — register with `BullModule.registerQueue({ name: ORDER_FICHA_QUEUE })`. */
export const ORDER_FICHA_QUEUE = 'order-ficha';

/**
 * BullMQ worker que roda o orquestrador da Ficha do Pedido depois de cada
 * mensagem inbound nova do cliente. Enfileirado pelo InboundMessageProcessor
 * DEPOIS do commit da transação de persistência da mensagem.
 *
 * Nunca deve derrubar o worker — qualquer erro (LLM fora do ar, JSON
 * malformado, etc.) é logado e o job simplesmente não produz side-effect.
 */
@Processor(ORDER_FICHA_QUEUE)
export class OrderFichaProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderFichaProcessor.name);

  constructor(private readonly service: OrderFichaService) {
    super();
  }

  async process(job: Job<IngestInput>): Promise<void> {
    try {
      await this.service.ingestMessage(job.data);
    } catch (e) {
      this.logger.error(`order-ficha job falhou: ${e}`);
    }
  }
}
