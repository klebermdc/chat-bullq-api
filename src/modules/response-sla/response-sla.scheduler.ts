import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { stageJobId, type SlaStage, type StagePlan } from './response-sla.rules';
import {
  RESPONSE_SLA_QUEUE,
  RESPONSE_SLA_STAGE_JOB,
  type SlaRecord,
  type StageJobData,
} from './response-sla.types';

const KEEP_FINISHED_JOBS = 100;

/** Agenda os jobs atrasados de aviso/estouro na fila `sla-timers`. */
@Injectable()
export class ResponseSlaScheduler {
  constructor(@InjectQueue(RESPONSE_SLA_QUEUE) private readonly queue: Queue) {}

  /** Agenda as etapas que ainda não aconteceram nesta espera. */
  async scheduleOpenStages(record: SlaRecord, plan: StagePlan, now: Date): Promise<void> {
    if (record.breached) return;
    if (plan.warnAt && !record.warnedAt) {
      await this.schedule(record, 'warn', plan.warnAt, now);
    }
    if (plan.dueAt) {
      await this.schedule(record, 'breach', plan.dueAt, now);
    }
  }

  async schedule(record: SlaRecord, stage: SlaStage, at: Date, now: Date): Promise<void> {
    const data: StageJobData = {
      recordId: record.id,
      conversationId: record.conversationId,
      waitingSince: record.waitingSince.getTime(),
      stage,
    };
    await this.queue.add(RESPONSE_SLA_STAGE_JOB, data, {
      jobId: stageJobId(record.conversationId, record.waitingSince, stage, at),
      delay: Math.max(0, at.getTime() - now.getTime()),
      removeOnComplete: KEEP_FINISHED_JOBS,
      removeOnFail: KEEP_FINISHED_JOBS,
    });
  }
}
