import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { EnrollmentsRepository } from '../cadences/enrollments.repository';
import { CadencesRepository } from '../cadences/cadences.repository';
import { CadenceRunner } from '../cadences/cadence-runner.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AutoReengageService } from './inactivity/auto-reengage.service';
import { CADENCE_SILENCE_QUEUE, CADENCE_SILENCE_JOB } from './scheduling.constants';

/** Quiet hours da retomada: 20h→8h no fuso padrão do Brasil. */
const RESUME_QUIET_START = 20;
const RESUME_QUIET_END = 8;
const RESUME_TZ = 'America/Sao_Paulo';

/**
 * Watchdog de silêncio da cadência. A cada disparo decide: no-op / cancelar /
 * rearmar / retomar. Idempotente — reprocessar o mesmo job não duplica efeitos
 * (todas as transições passam por compare-and-set no enrollment).
 */
@Processor(CADENCE_SILENCE_QUEUE, { concurrency: 5 })
export class CadenceSilenceProcessor extends WorkerHost {
  private readonly logger = new Logger(CadenceSilenceProcessor.name);

  constructor(
    private readonly enrollments: EnrollmentsRepository,
    private readonly cadences: CadencesRepository,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => CadenceRunner))
    private readonly runner: CadenceRunner,
    @InjectQueue(CADENCE_SILENCE_QUEUE) private readonly queue: Queue,
    private readonly realtime: RealtimeGateway,
    private readonly autoReengage: AutoReengageService,
  ) {
    super();
  }

  async process(job: Job<{ enrollmentId: string }>): Promise<void> {
    const { enrollmentId } = job.data;
    const enrollment = await this.enrollments.findById(enrollmentId);
    if (!enrollment || enrollment.status !== 'PAUSED') return;

    const cadence = await this.cadences.findById(enrollment.cadenceId);
    if (!cadence) return;
    const windowMinutes = cadence.silenceWindowMinutes ?? 1440;
    const windowMs = windowMinutes * 60_000;

    // (2) Card saiu da etapa gatilho → o humano assumiu; encerra sem retomar.
    if (cadence.stageId && enrollment.cardId) {
      const card = await this.prisma.card.findUnique({
        where: { id: enrollment.cardId },
        select: { stageId: true },
      });
      if (card && card.stageId !== cadence.stageId) {
        const claimed = await this.enrollments.finishIfLive(enrollment.id, {
          status: 'HANDED_OFF',
          endedAt: new Date(),
          endReason: 'stage_changed',
        });
        if (claimed) {
          this.realtime.emitToConversation(
            enrollment.conversationId,
            'cadence:stopped',
            { enrollmentId: enrollment.id, reason: 'stage_changed' },
          );
        }
        return;
      }
    }

    // (3) Silêncio dos dois lados: última mensagem da conversa (qualquer autor).
    const last = await this.prisma.message.findFirst({
      where: { conversationId: enrollment.conversationId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const lastMs = last?.createdAt
      ? new Date(last.createdAt).getTime()
      : enrollment.pausedAt
        ? new Date(enrollment.pausedAt).getTime()
        : 0;
    const elapsed = Date.now() - lastMs;

    if (elapsed < windowMs) {
      const delay = Math.max(0, lastMs + windowMs - Date.now());
      await this.queue.add(
        CADENCE_SILENCE_JOB,
        { enrollmentId },
        {
          delay,
          jobId: `cadsil-${enrollmentId}-${Date.now() + delay}`,
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
      return;
    }

    // (4) Silêncio suficiente → retoma no próximo horário permitido.
    const dispatchAt = this.autoReengage.nextAllowedTime(
      new Date(),
      RESUME_QUIET_START,
      RESUME_QUIET_END,
      RESUME_TZ,
    );
    await this.runner.resumeAtStep(enrollmentId, dispatchAt);
  }
}
