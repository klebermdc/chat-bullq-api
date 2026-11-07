import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  AUTO_CLOSE_JOB,
  AUTO_CLOSE_PATTERN,
  AUTO_CLOSE_QUEUE,
  AUTO_CLOSE_TZ,
} from './auto-close.processor';

const RETRY_DELAY_MS = 60_000;

/** Registra o job diário no boot (mesmo padrão do ErrorRetentionCron). */
@Injectable()
export class AutoCloseCron implements OnModuleInit {
  private readonly logger = new Logger(AutoCloseCron.name);

  constructor(@InjectQueue(AUTO_CLOSE_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        'conversation-auto-close-cron',
        { pattern: AUTO_CLOSE_PATTERN, tz: AUTO_CLOSE_TZ },
        {
          name: AUTO_CLOSE_JOB,
          data: {},
          opts: {
            removeOnComplete: 10,
            removeOnFail: 10,
            attempts: 3,
            backoff: { type: 'exponential', delay: RETRY_DELAY_MS },
          },
        },
      );
      this.logger.log(
        `fechamento automático agendado: ${AUTO_CLOSE_PATTERN} ${AUTO_CLOSE_TZ}`,
      );
    } catch (err) {
      // Falhar aqui não pode impedir o boot da API.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`falha ao agendar fechamento automático: ${msg}`);
    }
  }
}
