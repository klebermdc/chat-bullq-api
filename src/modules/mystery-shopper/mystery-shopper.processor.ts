import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { DelayedError, Job, Queue } from 'bullmq';
import {
  EVALUATE_JOB,
  KEEP_FINISHED_JOBS,
  MYSTERY_SHOPPER_QUEUE,
  SWEEP_JOB,
  SWEEP_PATTERN,
  SWEEP_SCHEDULER_ID,
  SWEEP_TIMEZONE,
} from './mystery-shopper.constants';
import { BOT_TURN_JOB } from './bot/bot.constants';
import { BotTurnService } from './bot/bot-turn.service';
import { MysteryShopperService } from './mystery-shopper.service';
import { VisitEvaluatorService } from './visit-evaluator.service';

/**
 * A cada 15 min: abre visitas e manda avaliar as paradas há 72h.
 * Concorrência 1: tarefa de fundo, não disputa a IA com o atendimento.
 * Sem número cadastrado a varredura não faz nada (2 consultas vazias).
 */
@Processor(MYSTERY_SHOPPER_QUEUE, { concurrency: 1 })
export class MysteryShopperProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(MysteryShopperProcessor.name);

  constructor(
    private readonly service: MysteryShopperService,
    private readonly evaluator: VisitEvaluatorService,
    private readonly botTurn: BotTurnService,
    @InjectQueue(MYSTERY_SHOPPER_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        SWEEP_SCHEDULER_ID,
        { pattern: SWEEP_PATTERN, tz: SWEEP_TIMEZONE },
        { name: SWEEP_JOB, opts: { removeOnComplete: KEEP_FINISHED_JOBS, removeOnFail: KEEP_FINISHED_JOBS } },
      );
      this.logger.log(`mystery_shopper_sweep_registered pattern=${SWEEP_PATTERN}`);
    } catch (err) {
      // Falhar aqui não pode impedir o boot da API.
      this.logger.error(`Falha registrando a varredura do cliente oculto: ${(err as Error).message}`);
    }
  }

  async process(job: Job, token?: string): Promise<unknown> {
    if (job.name === BOT_TURN_JOB) return this.processBotTurn(job, token);
    if (job.name === EVALUATE_JOB) return this.evaluator.evaluate((job.data as { visitId: string }).visitId);
    return this.service.sweep();
  }

  /** Fora do horário o mesmo job volta a ser atrasado (mantém o jobId, então o debounce continua valendo). */
  private async processBotTurn(job: Job, token?: string): Promise<unknown> {
    const runId = (job.data as { runId: string }).runId;
    try {
      const outcome = await this.botTurn.run(runId);
      if (outcome.kind !== 'DELAYED') return outcome.kind;
      await job.moveToDelayed(Date.now() + outcome.delayMs, token);
    } catch (err) {
      // Qualquer falha (menos o atraso) encerra a execução: ela não pode ficar ACTIVE sem job.
      await this.botTurn.markFailed(runId, (err as Error).message).catch(() => undefined);
      throw err;
    }
    throw new DelayedError();
  }

  // O job de avaliação é apagado ao falhar: sem este log, o erro some.
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    this.logger.error(`mystery_job_failed job=${job?.name} data=${JSON.stringify(job?.data)}: ${err.message}`);
  }
}
