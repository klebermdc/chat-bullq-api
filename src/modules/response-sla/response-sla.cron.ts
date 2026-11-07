import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  RESPONSE_SLA_QUEUE,
  RESPONSE_SLA_RECONCILE_JOB,
  RESPONSE_SLA_RECONCILE_PATTERN,
} from './response-sla.types';

const KEEP_FINISHED_JOBS = 10;

/** Registra a varredura de esperas órfãs no boot (mesmo padrão do AutoCloseCron). */
@Injectable()
export class ResponseSlaCron implements OnModuleInit {
  private readonly logger = new Logger(ResponseSlaCron.name);

  constructor(@InjectQueue(RESPONSE_SLA_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        'response-sla-reconcile-cron',
        { pattern: RESPONSE_SLA_RECONCILE_PATTERN },
        {
          name: RESPONSE_SLA_RECONCILE_JOB,
          data: {},
          opts: { removeOnComplete: KEEP_FINISHED_JOBS, removeOnFail: KEEP_FINISHED_JOBS },
        },
      );
    } catch (err) {
      // Falhar aqui não pode impedir o boot da API.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`falha ao agendar a varredura do SLA de resposta: ${msg}`);
    }
  }
}
