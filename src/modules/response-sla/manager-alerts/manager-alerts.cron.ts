import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  MANAGER_ALERTS_PATTERN,
  MANAGER_ALERTS_QUEUE,
  MANAGER_ALERTS_TICK_JOB,
} from './manager-alerts.types';

const KEEP_FINISHED_JOBS = 10;

/** Registra o tique no boot (mesmo padrão do ResponseSlaCron). */
@Injectable()
export class ManagerAlertsCron implements OnModuleInit {
  private readonly logger = new Logger(ManagerAlertsCron.name);

  constructor(@InjectQueue(MANAGER_ALERTS_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        'sla-manager-alerts-cron',
        { pattern: MANAGER_ALERTS_PATTERN },
        {
          name: MANAGER_ALERTS_TICK_JOB,
          data: {},
          opts: { removeOnComplete: KEEP_FINISHED_JOBS, removeOnFail: KEEP_FINISHED_JOBS },
        },
      );
    } catch (err) {
      // Falhar aqui não pode impedir o boot da API.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`falha ao agendar os avisos de SLA para a gestão: ${msg}`);
    }
  }
}
