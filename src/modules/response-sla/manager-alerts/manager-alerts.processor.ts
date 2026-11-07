import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ManagerAlertsService } from './manager-alerts.service';
import { MANAGER_ALERTS_QUEUE, MANAGER_ALERTS_TICK_JOB } from './manager-alerts.types';

/** Worker do tique de 5 min (resumo + placar). O serviço não lança. */
@Processor(MANAGER_ALERTS_QUEUE, { concurrency: 1 })
export class ManagerAlertsProcessor extends WorkerHost {
  constructor(private readonly service: ManagerAlertsService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== MANAGER_ALERTS_TICK_JOB) {
      return { skipped: true, reason: `job_desconhecido:${job.name}` };
    }
    await this.service.runTick(new Date());
    return { ok: true };
  }
}
