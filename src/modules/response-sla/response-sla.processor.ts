import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ResponseSlaStageHandler } from './response-sla-stage.handler';
import {
  RESPONSE_SLA_QUEUE,
  RESPONSE_SLA_RECONCILE_JOB,
  RESPONSE_SLA_STAGE_JOB,
  type StageJobData,
} from './response-sla.types';

/**
 * Worker da fila `sla-timers`. Substitui o antigo SlaTimerProcessor (SLA por
 * departamento, que nunca era agendado). Jobs antigos `sla-check` que ainda
 * estejam no Redis são ignorados.
 */
@Processor(RESPONSE_SLA_QUEUE, { concurrency: 2 })
export class ResponseSlaProcessor extends WorkerHost {
  private readonly logger = new Logger(ResponseSlaProcessor.name);

  constructor(private readonly handler: ResponseSlaStageHandler) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === RESPONSE_SLA_STAGE_JOB) {
      const data = job.data as StageJobData;
      const outcome = await this.handler.handle(data, new Date());
      this.logger.log(`sla_resposta ${data.stage} conv=${data.conversationId}: ${outcome}`);
      return { outcome };
    }
    if (job.name === RESPONSE_SLA_RECONCILE_JOB) {
      const closed = await this.handler.reconcile(new Date());
      if (closed > 0) this.logger.log(`sla_resposta reconcile: ${closed} esperas fechadas`);
      return { closed };
    }
    return { skipped: true, reason: `job_desconhecido:${job.name}` };
  }
}
