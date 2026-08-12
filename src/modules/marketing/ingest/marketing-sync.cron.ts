import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { AdConnectionRepository } from '../connection/ad-connection.repository';
import {
  MARKETING_SYNC_CRON_JOB,
  MARKETING_SYNC_CRON_PATTERN,
  MARKETING_SYNC_CRON_QUEUE,
  MARKETING_SYNC_WINDOW_DAYS,
} from '../marketing.constants';
import { MarketingSyncQueue } from './marketing-sync.queue';

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Tick diário. Não sincroniza nada: só enfileira um job por conexão ativa,
 * para que uma conta lenta nunca segure as outras.
 */
@Processor(MARKETING_SYNC_CRON_QUEUE, { concurrency: 1 })
export class MarketingSyncCron extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(MarketingSyncCron.name);

  constructor(
    private readonly repo: AdConnectionRepository,
    private readonly syncQueue: MarketingSyncQueue,
    @InjectQueue(MARKETING_SYNC_CRON_QUEUE) private readonly cronQueue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.cronQueue.add(
        MARKETING_SYNC_CRON_JOB,
        {},
        {
          repeat: { pattern: MARKETING_SYNC_CRON_PATTERN },
          jobId: 'marketing-sync-cron',
          removeOnComplete: 10,
          removeOnFail: 10,
        },
      );
    } catch (err) {
      // Redis fora no boot não pode derrubar a API inteira.
      this.logger.error(`falha ao registrar o cron: ${(err as Error).message}`);
    }
  }

  async process(_job: Job): Promise<void> {
    const connections = await this.repo.findActive();
    const since = isoDay(MARKETING_SYNC_WINDOW_DAYS);
    const until = isoDay(0);

    for (const connection of connections) {
      try {
        await this.syncQueue.enqueueSync({
          connectionId: connection.id,
          since,
          until,
          reason: 'daily',
        });
      } catch (err) {
        this.logger.error(
          `falha ao enfileirar sync da conexao ${connection.id}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(`tick diario enfileirou ${connections.length} conexoes`);
  }
}
