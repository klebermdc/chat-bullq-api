import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { VOICE_OUTREACH_QUEUE, VOICE_OUTREACH_SWEEP_JOB, VOICE_OUTREACH_SWEEP_PATTERN } from './outreach.constants';
import { OutreachService } from './outreach.service';

const KEEP_FINISHED_JOBS = 10;

/** Registra a varredura das ligações de retorno no boot (falha aqui não derruba a API). */
@Injectable()
export class OutreachCron implements OnModuleInit {
  private readonly logger = new Logger(OutreachCron.name);

  constructor(@InjectQueue(VOICE_OUTREACH_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        'voice-outreach-sweep-cron',
        { pattern: VOICE_OUTREACH_SWEEP_PATTERN },
        { name: VOICE_OUTREACH_SWEEP_JOB, data: {}, opts: { removeOnComplete: KEEP_FINISHED_JOBS, removeOnFail: KEEP_FINISHED_JOBS } },
      );
    } catch (err) {
      this.logger.error(`falha ao agendar a varredura de ligações: ${(err as Error).message}`);
    }
  }
}

@Processor(VOICE_OUTREACH_QUEUE, { concurrency: 1 })
export class OutreachProcessor extends WorkerHost {
  constructor(private readonly outreach: OutreachService) {
    super();
  }

  async process(): Promise<void> {
    await this.outreach.sweep(new Date());
  }
}
