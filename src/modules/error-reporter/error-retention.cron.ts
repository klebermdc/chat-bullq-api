import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  ERROR_RETENTION_JOB,
  ERROR_RETENTION_PATTERN,
  ERROR_RETENTION_QUEUE,
} from './error-retention.processor';

/** Mesmo padrão de agendamento já usado por WatchdogCronService. */
@Injectable()
export class ErrorRetentionCron implements OnModuleInit {
  private readonly logger = new Logger(ErrorRetentionCron.name);

  constructor(
    @InjectQueue(ERROR_RETENTION_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.add(
        ERROR_RETENTION_JOB,
        {},
        {
          repeat: { pattern: ERROR_RETENTION_PATTERN },
          jobId: 'error-retention-cron',
          removeOnComplete: 10,
          removeOnFail: 10,
          // O processor agora relança em falha (ver error-retention.processor.ts)
          // justamente para habilitar este retry: um blip transitório do
          // Postgres às 04:10 não pode custar o dia inteiro sem poda.
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
        },
      );
      this.logger.log(`poda agendada: ${ERROR_RETENTION_PATTERN}`);
    } catch (err) {
      // Falhar aqui não pode impedir o boot — sem poda o sistema segue de pé.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`falha ao agendar poda: ${msg}`);
    }
  }
}
