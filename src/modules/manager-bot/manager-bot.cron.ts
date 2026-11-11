import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { ManagerBotService } from './manager-bot.service';
import { MANAGER_BOT_PATTERN, MANAGER_BOT_QUEUE, MANAGER_BOT_TICK_JOB } from './manager-bot.types';

const KEEP_FINISHED_JOBS = 10;

/** Registra o tique de 5 min no boot (mesmo padrão do ManagerAlertsCron). */
@Injectable()
export class ManagerBotCron implements OnModuleInit {
  private readonly logger = new Logger(ManagerBotCron.name);

  constructor(@InjectQueue(MANAGER_BOT_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        'manager-bot-cron',
        { pattern: MANAGER_BOT_PATTERN },
        {
          name: MANAGER_BOT_TICK_JOB,
          data: {},
          opts: { removeOnComplete: KEEP_FINISHED_JOBS, removeOnFail: KEEP_FINISHED_JOBS },
        },
      );
    } catch (err) {
      // Falhar aqui não pode impedir o boot da API.
      this.logger.error(`falha ao agendar o gerente no Telegram: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Worker do tique. O serviço não lança. */
@Processor(MANAGER_BOT_QUEUE, { concurrency: 1 })
export class ManagerBotProcessor extends WorkerHost {
  constructor(private readonly service: ManagerBotService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== MANAGER_BOT_TICK_JOB) return { skipped: true, reason: `job_desconhecido:${job.name}` };
    await this.service.runTick(new Date());
    return { ok: true };
  }
}
