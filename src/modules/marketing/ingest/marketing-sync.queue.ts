import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { MARKETING_SYNC_JOB, MARKETING_SYNC_QUEUE } from '../marketing.constants';

export interface MarketingSyncJobData {
  connectionId: string;
  /** YYYY-MM-DD */
  since: string;
  /** YYYY-MM-DD */
  until: string;
  reason: 'backfill' | 'daily';
}

@Injectable()
export class MarketingSyncQueue {
  constructor(@InjectQueue(MARKETING_SYNC_QUEUE) private readonly queue: Queue) {}

  async enqueueSync(data: MarketingSyncJobData): Promise<void> {
    // jobId estável por conexão+janela: o tick diário e um clique no botão
    // Atualizar no mesmo minuto não viram dois syncs concorrentes.
    await this.queue.add(MARKETING_SYNC_JOB, data, {
      jobId: `marketing-sync-${data.connectionId}-${data.since}-${data.until}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 60000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  }
}
