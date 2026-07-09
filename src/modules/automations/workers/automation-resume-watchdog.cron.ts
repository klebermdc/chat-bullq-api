import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { AutomationRunStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  AUTOMATION_RESUME_QUEUE,
  AUTOMATION_RESUME_WATCHDOG_QUEUE,
  AUTOMATION_RESUME_WATCHDOG_JOB,
  RESUME_WATCHDOG_PATTERN,
  RESUME_CLAIM_BATCH_SIZE,
} from '../automations.constants';

// Varre AutomationRun WAITING com resumeAt vencido e enfileira um job de
// retomada por run. Mesmo padrão do RecoveryWatchdogCron: repeat no boot,
// scan no worker.
//
// NÃO flipa o status ao enfileirar — o jobId `resume:<runId>` garante dedup
// (BullMQ ignora job com id repetido enquanto ativo/na fila) e o resumeRun é
// idempotente. Assim, se um resume falhar/reiniciar, um tick futuro
// re-enfileira naturalmente.
@Processor(AUTOMATION_RESUME_WATCHDOG_QUEUE, { concurrency: 1 })
export class AutomationResumeWatchdogCron
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(AutomationResumeWatchdogCron.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(AUTOMATION_RESUME_QUEUE) private readonly resumeQueue: Queue,
    @InjectQueue(AUTOMATION_RESUME_WATCHDOG_QUEUE)
    private readonly watchdogQueue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.watchdogQueue.add(
        AUTOMATION_RESUME_WATCHDOG_JOB,
        {},
        {
          repeat: { pattern: RESUME_WATCHDOG_PATTERN },
          jobId: 'automation-resume-watchdog-cron',
          removeOnComplete: 10,
          removeOnFail: 10,
        },
      );
    } catch (err) {
      this.logger.error(
        `falha ao registrar watchdog repeat: ${(err as Error).message}`,
      );
    }
  }

  async process(_job: Job): Promise<void> {
    await this.claimAndEnqueueDueRuns(new Date());
  }

  // Testável isoladamente. Retorna quantos runs foram enfileirados.
  async claimAndEnqueueDueRuns(now: Date): Promise<number> {
    const due = await this.prisma.automationRun.findMany({
      where: {
        status: AutomationRunStatus.WAITING,
        resumeAt: { lte: now },
      },
      select: { id: true, organizationId: true },
      orderBy: { resumeAt: 'asc' },
      take: RESUME_CLAIM_BATCH_SIZE,
    });

    for (const run of due) {
      await this.resumeQueue.add(
        'resume',
        { runId: run.id, organizationId: run.organizationId },
        {
          jobId: `resume:${run.id}`,
          removeOnComplete: true,
          removeOnFail: 50,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2_000 },
        },
      );
    }

    if (due.length > 0) {
      this.logger.log(`enfileirados ${due.length} run(s) de resume`);
    }
    return due.length;
  }
}
