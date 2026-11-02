import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { previousDayKey } from './diary-day';
import { DiaryConfigService } from './diary-config.service';
import { DiaryRepository } from './diary.repository';
import { DiaryService } from './diary.service';
import {
  DIARY_DAILY_JOB,
  DIARY_GENERATE_JOB,
  DIARY_QUEUE,
  KEEP_FINISHED_JOBS,
  diaryJobOptions,
} from './diary.constants';
import type { DiaryGenerateJobData } from './diary.types';

const CRON_JOB_ID = 'attendant-diary-cron';

/**
 * De madrugada, enfileira o diário do dia anterior de cada participante; cada
 * diário é um job, para a falha de um não afetar os outros. Concorrência 1 de
 * propósito: é tarefa de fundo e não pode disputar a IA com o atendimento.
 */
@Processor(DIARY_QUEUE, { concurrency: 1 })
export class DiaryCron extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(DiaryCron.name);

  constructor(
    private readonly service: DiaryService,
    private readonly repository: DiaryRepository,
    private readonly config: DiaryConfigService,
    @InjectQueue(DIARY_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      if (!this.config.isEnabled) {
        // Tira o agendamento antigo, se a lista foi esvaziada.
        await this.queue.removeJobScheduler(CRON_JOB_ID);
        this.logger.log('attendant_diary_disabled: lista de participantes vazia');
        return;
      }
      // upsert troca o horário antigo; `add` com repeat deixaria os dois ativos.
      await this.queue.upsertJobScheduler(
        CRON_JOB_ID,
        { pattern: this.config.cronPattern, tz: this.config.cronTimeZone },
        {
          name: DIARY_DAILY_JOB,
          opts: { removeOnComplete: KEEP_FINISHED_JOBS, removeOnFail: KEEP_FINISHED_JOBS },
        },
      );
      this.logger.log(`attendant_diary_cron_registered pattern=${this.config.cronPattern}`);
    } catch (err) {
      this.logger.error(`Falha registrando cron do diário: ${(err as Error).message}`);
    }
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === DIARY_GENERATE_JOB) {
      return this.service.generate(job.data as DiaryGenerateJobData);
    }
    return this.enqueueYesterday();
  }

  // O job é apagado ao falhar (ver diaryJobOptions): sem este log, o erro some.
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    this.logger.error(`diary_job_failed job=${job?.name} data=${JSON.stringify(job?.data)}: ${err.message}`);
  }

  private async enqueueYesterday(): Promise<{ queued: number }> {
    // Lista esvaziada sem reiniciar o cron: o job repetido não gasta nada.
    const participants = await this.repository.findParticipants(this.config.participantEmails);
    const now = new Date();
    await Promise.all(
      participants.map((p) => {
        const data: DiaryGenerateJobData = {
          organizationId: p.organizationId,
          userId: p.userId,
          day: previousDayKey(now, p.timeZone),
        };
        return this.queue.add(
          DIARY_GENERATE_JOB,
          data,
          diaryJobOptions(data.organizationId, data.userId, data.day),
        );
      }),
    );
    return { queued: participants.length };
  }
}
