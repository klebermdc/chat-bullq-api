import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AUTOMATION_RESUME_QUEUE } from '../automations.constants';
import { AutomationResumeJobData } from '../automations.types';
import { KillSwitchService } from '../kill-switch.service';
import { AutomationExecutorService } from '../engine/automation-executor.service';

@Processor(AUTOMATION_RESUME_QUEUE, { concurrency: 4 })
export class AutomationResumeProcessor extends WorkerHost {
  private readonly logger = new Logger(AutomationResumeProcessor.name);

  constructor(
    private readonly killSwitch: KillSwitchService,
    private readonly executor: AutomationExecutorService,
  ) {
    super();
  }

  async process(job: Job<AutomationResumeJobData>): Promise<void> {
    // Kill-switch OFF: não retoma agora. NÃO joga o run fora — deixa WAITING
    // com o resumeAt já vencido; quando religarem o switch, o watchdog o
    // reivindica de novo no próximo tick. Só não re-throw (evita retry loop).
    if (!this.killSwitch.isEnabled()) {
      this.logger.warn(
        `kill-switch OFF — resume adiado (run=${job.data.runId})`,
      );
      return;
    }

    // resumeRun re-throw em contenção de lock → BullMQ retenta (attempts+backoff
    // configurados no enqueue). Qualquer outro erro também sobe para retry.
    await this.executor.resumeRun(job.data);
  }
}
