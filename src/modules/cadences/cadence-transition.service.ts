import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CadenceEnrollment,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Token de injeção do runner. Evita import direto de `CadenceRunner` (Task 7),
 * que criaria dependência circular runner↔transition. A Task 7 registra
 * `{ provide: CADENCE_RUNNER, useExisting: CadenceRunner }`.
 */
export const CADENCE_RUNNER = 'CADENCE_RUNNER';

/** Superfície do runner usada aqui — só `stop`. */
export interface CadenceRunnerPort {
  stop(enrollmentId: string, reason: string): Promise<unknown>;
}

export type TransitionOutcome =
  | 'SIM'
  | 'NAO'
  | 'DESCADASTRAR'
  | 'ENGAGED'
  | 'AMBIGUO'
  | 'EXHAUSTED';

/** Subset mínimo da Cadence necessário para aplicar os efeitos. */
export interface TransitionCadence {
  hotTagId?: string | null;
  lostStageId?: string | null;
  optOutTagId?: string | null;
}

/**
 * Aplica os efeitos de uma transição de cadência (encerra o enrollment via
 * runner + move card / aplica tags / faz handoff ao vendedor + notifica).
 *
 * Reuso: em vez dos handlers do `automations` (que exigem um ActionContext
 * pesado — outbox, actorId com FK de usuário, channelId que o enrollment não
 * tem), usamos escritas Prisma diretas + `NotificationsService`. É o caminho
 * mais limpo e testável para este serviço de domínio.
 *
 * Idempotente: só age se o enrollment ainda estiver ACTIVE.
 */
@Injectable()
export class CadenceTransitionService {
  private readonly logger = new Logger(CadenceTransitionService.name);

  constructor(
    @Inject(CADENCE_RUNNER) private readonly runner: CadenceRunnerPort,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async apply(
    enrollment: CadenceEnrollment,
    outcome: TransitionOutcome,
    cadence: TransitionCadence,
  ): Promise<void> {
    // Guarda de idempotência: uma cadência já encerrada não sofre efeitos de
    // novo (evita dupla tag/assign se o inbound reprocessar a mesma resposta).
    if (enrollment.status !== 'ACTIVE') return;

    switch (outcome) {
      case 'SIM':
        await this.runner.stop(enrollment.id, 'replied_yes');
        if (cadence.hotTagId) {
          await this.addConversationTag(
            enrollment.conversationId,
            cadence.hotTagId,
          );
        }
        await this.handoff(enrollment);
        break;

      case 'ENGAGED':
      case 'AMBIGUO':
        // Regra de ouro: na dúvida nunca descarta o lead → trata como engajou.
        await this.runner.stop(enrollment.id, 'engaged');
        await this.handoff(enrollment);
        break;

      case 'NAO':
        await this.runner.stop(enrollment.id, 'said_no');
        if (cadence.lostStageId) {
          await this.moveCardToStage(enrollment, cadence.lostStageId);
        }
        break;

      case 'DESCADASTRAR':
        await this.runner.stop(enrollment.id, 'opt_out');
        if (cadence.optOutTagId) {
          await this.addContactTag(enrollment.contactId, cadence.optOutTagId);
        }
        break;

      case 'EXHAUSTED':
        // O runner já marcou COMPLETED_NO_REPLY e chamou aqui; só move o card.
        if (cadence.lostStageId) {
          await this.moveCardToStage(enrollment, cadence.lostStageId);
        }
        break;
    }
  }

  /** Reabre a conversa para o humano e avisa o vendedor responsável. */
  private async handoff(enrollment: CadenceEnrollment): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: enrollment.conversationId },
    });
    if (!conversation) return;

    const sellerId = conversation.assignedToId ?? null;

    // Reabre: com vendedor → OPEN (ele assume); sem vendedor → PENDING (pool).
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: sellerId ? 'OPEN' : 'PENDING' },
    });

    const title = 'Lead respondeu na cadência';
    const body = 'Um lead em cadência de negociação respondeu — assuma a conversa.';
    const data = {
      conversationId: enrollment.conversationId,
      enrollmentId: enrollment.id,
    };

    if (sellerId) {
      await this.notifications.notify({
        recipientId: sellerId,
        organizationId: enrollment.organizationId,
        type: NotificationType.SYSTEM,
        title,
        body,
        data,
      });
    } else {
      await this.notifications.notifyOrgAgents({
        organizationId: enrollment.organizationId,
        type: NotificationType.SYSTEM,
        title,
        body,
        data,
      });
    }
  }

  private async moveCardToStage(
    enrollment: CadenceEnrollment,
    stageId: string,
  ): Promise<void> {
    if (!enrollment.cardId) return;
    await this.prisma.card.update({
      where: { id: enrollment.cardId },
      data: { stageId, status: 'LOST', closedAt: new Date() },
    });
  }

  private async addConversationTag(
    conversationId: string,
    tagId: string,
  ): Promise<void> {
    try {
      await this.prisma.conversationTag.create({
        data: { conversationId, tagId },
      });
    } catch (err) {
      if (this.isDuplicate(err)) return;
      throw err;
    }
  }

  private async addContactTag(contactId: string, tagId: string): Promise<void> {
    try {
      await this.prisma.contactTag.create({ data: { contactId, tagId } });
    } catch (err) {
      if (this.isDuplicate(err)) return;
      throw err;
    }
  }

  /** Tag já aplicada → sucesso silencioso (idempotente). */
  private isDuplicate(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    );
  }
}
