import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CadenceRunner } from '../cadences/cadence-runner.service';
import { PipelinesService } from './pipelines.service';
import { MoveCardDto } from './dto/pipeline.dto';
import { LOST_REASONS, type LostReason } from './lost-sale.constants';
import {
  LOST_RECOVERY_PIPELINE_KEY,
  LOST_RECOVERY_STAGES,
  RECOVERED_STAGE_KEY,
} from './lost-recovery.constants';

/** Onde o card de recuperação estava antes da marcação — o "Desfazer" usa. */
export interface RecoveryPlacement {
  cardId: string;
  created: boolean;
  fromStageId: string | null;
}

interface RecoveryPipeline {
  id: string;
  stages: { id: string; key: string | null; order: number }[];
}

/**
 * Funil "Recuperação de perdidas": card na coluna do motivo, cadência da
 * coluna (se o operador configurou uma) e "Recuperado" quando a venda fecha.
 * Os cards ficam sempre OPEN (etapas NORMAL) — ver lost-recovery.constants.
 */
@Injectable()
export class LostRecoveryService {
  private readonly logger = new Logger(LostRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipelines: PipelinesService,
    @Inject(forwardRef(() => CadenceRunner))
    private readonly cadenceRunner: CadenceRunner,
  ) {}

  async place(
    organizationId: string,
    conversation: { id: string; assignedToId?: string | null },
    reason: LostReason,
    note: string | null,
  ): Promise<RecoveryPlacement | null> {
    const pipeline = await this.ensurePipeline(organizationId);
    const stageId = this.stageFor(pipeline, reason);
    if (!stageId) {
      this.logger.warn(`lost_recovery_no_stages pipeline=${pipeline.id}`);
      return null;
    }
    const existing = await this.findCard(organizationId, conversation.id);

    if (existing) {
      if (existing.stageId !== stageId) {
        // moveCard já dispara a cadência da etapa de destino.
        await this.move(existing.id, organizationId, stageId);
      }
      return { cardId: existing.id, created: false, fromStageId: existing.stageId };
    }

    const card = await this.pipelines.createCard(pipeline.id, organizationId, {
      conversationId: conversation.id,
      stageId,
      assignedToId: conversation.assignedToId ?? undefined,
      description: note ? `${LOST_REASONS[reason]}: ${note}` : LOST_REASONS[reason],
    });
    // createCard não dispara cadência (só o moveCard); aqui o card nasce na etapa.
    this.cadenceRunner
      .maybeStartForStage(conversation.id, card.id, stageId, organizationId)
      .catch((err) =>
        this.logger.warn(
          `lost_recovery_cadence_failed card=${card.id}: ${(err as Error).message}`,
        ),
      );
    return { cardId: card.id, created: true, fromStageId: null };
  }

  /** Desfaz o `place`: apaga o card criado ou devolve à coluna anterior. */
  async undo(organizationId: string, placement: RecoveryPlacement): Promise<void> {
    const card = await this.prisma.card.findFirst({
      where: { id: placement.cardId, organizationId },
      select: { id: true },
    });
    if (!card) return;
    if (placement.created) {
      await this.pipelines.removeCard(card.id, organizationId);
      return;
    }
    if (placement.fromStageId) {
      await this.move(card.id, organizationId, placement.fromStageId);
    }
  }

  /**
   * Antes do Ganho: quem comprou não recebe mais a cadência de recuperação (e
   * a inscrição viva impediria a cadência da etapa Ganho de começar).
   * Nunca lança — o Ganho é o que importa.
   */
  async stopRecoveryCadence(organizationId: string, conversationId: string): Promise<void> {
    try {
      const card = await this.findCard(organizationId, conversationId);
      if (!card) return;
      const live = await this.prisma.cadenceEnrollment.findFirst({
        where: {
          conversationId,
          cardId: card.id,
          status: { in: ['ACTIVE', 'PAUSED'] },
        },
        select: { id: true },
      });
      if (live) await this.cadenceRunner.stop(live.id, 'won');
    } catch (err) {
      this.logger.warn(
        `lost_recovery_stop_failed conv=${conversationId}: ${(err as Error).message}`,
      );
    }
  }

  /** Depois do Ganho: card de recuperação vai pra Recuperado. Nunca lança. */
  async markRecovered(organizationId: string, conversationId: string): Promise<void> {
    try {
      const card = await this.findCard(organizationId, conversationId);
      if (!card) return;
      const recovered = await this.prisma.pipelineStage.findFirst({
        where: { pipelineId: card.pipelineId, key: RECOVERED_STAGE_KEY },
        select: { id: true },
      });
      if (!recovered || recovered.id === card.stageId) return;
      await this.move(card.id, organizationId, recovered.id);
    } catch (err) {
      this.logger.warn(
        `lost_recovery_recovered_failed conv=${conversationId}: ${(err as Error).message}`,
      );
    }
  }

  private findCard(organizationId: string, conversationId: string) {
    return this.prisma.card.findFirst({
      where: {
        organizationId,
        conversationId,
        pipeline: { key: LOST_RECOVERY_PIPELINE_KEY },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, stageId: true, pipelineId: true },
    });
  }

  private move(cardId: string, organizationId: string, toStageId: string) {
    return this.pipelines.moveCard(cardId, organizationId, {
      toStageId,
      toIndex: 0,
    } as MoveCardDto);
  }

  /** Coluna do motivo; se o operador apagou essa coluna, a primeira do funil. */
  private stageFor(pipeline: RecoveryPipeline, reason: LostReason): string | null {
    const byKey = pipeline.stages.find((s) => s.key === reason);
    if (byKey) return byKey.id;
    const first = [...pipeline.stages].sort((a, b) => a.order - b.order)[0];
    return first?.id ?? null;
  }

  private async ensurePipeline(organizationId: string): Promise<RecoveryPipeline> {
    const found = await this.findPipeline(organizationId);
    if (found) return found;
    try {
      await this.prisma.pipeline.create({
        data: {
          organizationId,
          key: LOST_RECOVERY_PIPELINE_KEY,
          name: 'Recuperação de perdidas',
          description:
            'Leads dados como venda perdida, por motivo. Configure uma cadência em cada coluna para tentar recuperar.',
          icon: 'RotateCcw',
          color: 'amber',
          stages: {
            create: LOST_RECOVERY_STAGES.map((s, order) => ({
              key: s.key,
              name: s.name,
              color: s.color,
              type: 'NORMAL' as const,
              order,
            })),
          },
        },
      });
    } catch (err) {
      // Outro pedido criou ao mesmo tempo (unique org+key): usa o dele.
      const isRace =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
      if (!isRace) throw err;
    }
    return (await this.findPipeline(organizationId))!;
  }

  private findPipeline(organizationId: string) {
    return this.prisma.pipeline.findFirst({
      where: { organizationId, key: LOST_RECOVERY_PIPELINE_KEY },
      select: {
        id: true,
        stages: { select: { id: true, key: true, order: true } },
      },
    });
  }
}
