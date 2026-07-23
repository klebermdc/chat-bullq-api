import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { META_CAPI_QUEUE, META_CAPI_PURCHASE_JOB } from './meta-capi.constants';

export interface PurchaseJobData {
  cardId: string;
  organizationId: string;
}

/**
 * Enfileira o disparo do evento Purchase. Chamado no `moveCard` quando o card
 * entra numa etapa WON. Barato e fire-and-forget: NÃO consulta config aqui
 * (o processor decide se envia), pra nunca segurar/travar o move do kanban.
 */
@Injectable()
export class MetaCapiQueue {
  private readonly logger = new Logger(MetaCapiQueue.name);

  constructor(
    @InjectQueue(META_CAPI_QUEUE) private readonly queue: Queue,
  ) {}

  async enqueuePurchase(data: PurchaseJobData): Promise<void> {
    // jobId estável → reganhar o mesmo card não reprocessa em paralelo.
    await this.queue.add(META_CAPI_PURCHASE_JOB, data, {
      jobId: `meta-capi-purchase-${data.cardId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 200,
      removeOnFail: 200,
    });
  }
}
