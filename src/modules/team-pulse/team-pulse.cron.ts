import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { TeamPulseService } from './team-pulse.service';
import { TEAM_PULSE_PATTERN, TEAM_PULSE_QUEUE, TEAM_PULSE_TICK_JOB } from './team-pulse.types';

const KEEP_FINISHED_JOBS = 10;

/** Registra o tique de hora em hora no boot (mesmo padrão do ManagerAlertsCron). */
@Injectable()
export class TeamPulseCron implements OnModuleInit {
  private readonly logger = new Logger(TeamPulseCron.name);

  constructor(@InjectQueue(TEAM_PULSE_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        'team-pulse-cron',
        { pattern: TEAM_PULSE_PATTERN },
        {
          name: TEAM_PULSE_TICK_JOB,
          data: {},
          opts: { removeOnComplete: KEEP_FINISHED_JOBS, removeOnFail: KEEP_FINISHED_JOBS },
        },
      );
    } catch (err) {
      // Falhar aqui não pode impedir o boot da API.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`falha ao agendar o pulso do atendimento: ${msg}`);
    }
  }
}

/** Worker do tique. O serviço não lança. */
@Processor(TEAM_PULSE_QUEUE, { concurrency: 1 })
export class TeamPulseProcessor extends WorkerHost {
  constructor(private readonly service: TeamPulseService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== TEAM_PULSE_TICK_JOB) return { skipped: true, reason: `job_desconhecido:${job.name}` };
    await this.service.runTick(new Date());
    return { ok: true };
  }
}
