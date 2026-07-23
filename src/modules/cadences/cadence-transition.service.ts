import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  CadenceEnrollment,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MessagesService } from '../messaging/messages/messages.service';

/**
 * Token de injeção do runner. Evita import direto de `CadenceRunner` (Task 7),
 * que criaria dependência circular runner↔transition. A Task 7 registra
 * `{ provide: CADENCE_RUNNER, useExisting: CadenceRunner }`.
 */
export const CADENCE_RUNNER = 'CADENCE_RUNNER';

/**
 * Superfície do runner usada aqui — só `stop`. Contrato: devolve o enrollment
 * (truthy) SOMENTE quando este caminho venceu o compare-and-set atômico em
 * ACTIVE; devolve `null` quando não encontrou / já não estava ACTIVE / perdeu a
 * corrida. Os efeitos colaterais aqui só ocorrem quando o claim vence.
 */
export interface CadenceRunnerPort {
  stop(enrollmentId: string, reason: string): Promise<CadenceEnrollment | null>;
  pause(
    enrollmentId: string,
    silenceWindowMinutes: number,
  ): Promise<CadenceEnrollment | null>;
}

export type TransitionOutcome =
  | 'SIM'
  | 'NAO'
  | 'DESCADASTRAR'
  | 'ENGAGED'
  | 'AMBIGUO'
  | 'EXHAUSTED'
  | 'RESUMED';

/** Subset mínimo da Cadence necessário para aplicar os efeitos. */
export interface TransitionCadence {
  hotTagId?: string | null;
  lostStageId?: string | null;
  optOutTagId?: string | null;
  onYesMessage?: string | null;
  onNoMessage?: string | null;
  reviveEnabled?: boolean | null;
  silenceWindowMinutes?: number | null;
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
    // messaging↔cadences já é forwardRef no módulo; forwardRef aqui evita ciclo
    // de resolução ao injetar o MessagesService neste provider.
    @Inject(forwardRef(() => MessagesService))
    private readonly messages: MessagesService,
  ) {}

  async apply(
    enrollment: CadenceEnrollment,
    outcome: TransitionOutcome,
    cadence: TransitionCadence,
  ): Promise<void> {
    // Guarda de idempotência: só age em estado vivo (ACTIVE ou PAUSED). Já
    // encerrado não sofre efeitos de novo.
    if (enrollment.status !== 'ACTIVE' && enrollment.status !== 'PAUSED') return;

    switch (outcome) {
      case 'SIM': {
        // FIX 4: só aplica efeitos se venceu o compare-and-set atômico.
        const claimed = await this.runner.stop(enrollment.id, 'replied_yes');
        if (!claimed) break;
        // Mensagem de transição (aguarde) ANTES do handoff — só quem venceu o
        // claim envia, então uma corrida perdida não gera envio duplicado.
        if (cadence.onYesMessage) {
          await this.sendTransitionMessage(enrollment, cadence.onYesMessage);
        }
        if (cadence.hotTagId) {
          await this.addConversationTag(
            enrollment.conversationId,
            cadence.hotTagId,
          );
        }
        await this.handoff(enrollment);
        break;
      }

      case 'ENGAGED':
      case 'AMBIGUO': {
        // Regra de ouro: na dúvida nunca descarta o lead.
        const reviveEnabled = cadence.reviveEnabled ?? true;
        if (reviveEnabled) {
          // Resposta fraca: pausa e arma o watchdog de silêncio (não encerra).
          const window = cadence.silenceWindowMinutes ?? 1440;
          const paused = await this.runner.pause(enrollment.id, window);
          if (!paused) break; // já pausado / perdeu corrida → no-op
          await this.handoff(enrollment);
          break;
        }
        // Comportamento antigo: encerra e entrega ao humano.
        const claimed = await this.runner.stop(enrollment.id, 'engaged');
        if (!claimed) break;
        await this.handoff(enrollment);
        break;
      }

      case 'NAO': {
        const claimed = await this.runner.stop(enrollment.id, 'said_no');
        if (!claimed) break;
        // Mensagem de transição (agradecimento) ANTES de mover para perdido.
        if (cadence.onNoMessage) {
          await this.sendTransitionMessage(enrollment, cadence.onNoMessage);
        }
        if (cadence.lostStageId) {
          await this.moveCardToStage(enrollment, cadence.lostStageId);
        }
        break;
      }

      case 'DESCADASTRAR': {
        const claimed = await this.runner.stop(enrollment.id, 'opt_out');
        if (!claimed) break;
        if (cadence.optOutTagId) {
          await this.addContactTag(enrollment.contactId, cadence.optOutTagId);
        }
        break;
      }

      case 'RESUMED': {
        // Reengajamento (NO_REPLY): o cliente voltou a falar. Só encerra o
        // enrollment — a Aline (autônoma) reassume naturalmente pelo inbound.
        // Sem handoff a humano, sem tag, sem mover card.
        await this.runner.stop(enrollment.id, 'client_replied');
        break;
      }

      case 'EXHAUSTED':
        // O runner já marcou COMPLETED_NO_REPLY e chamou aqui; só move o card.
        if (cadence.lostStageId) {
          await this.moveCardToStage(enrollment, cadence.lostStageId);
        }
        break;
    }
  }

  /**
   * Envia ao cliente a mensagem configurada de transição (Sim/Não) antes de
   * aplicar os demais efeitos. Resolve `{nome}` com o nome do contato e usa um
   * remetente do sistema (responsável da conversa, senão o OWNER da org, igual
   * ao `CadenceRunner.resolveSystemSender`). Falha de envio nunca bloqueia a
   * transição — apenas registra warn.
   */
  private async sendTransitionMessage(
    enrollment: CadenceEnrollment,
    template: string,
  ): Promise<void> {
    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: enrollment.conversationId },
        select: {
          id: true,
          organizationId: true,
          contactId: true,
          assignedToId: true,
        },
      });
      if (!conversation) return;

      const senderId = await this.resolveSystemSender(
        conversation.organizationId,
        conversation.assignedToId ?? null,
      );
      if (!senderId) {
        this.logger.warn(
          `cadence_transition_no_sender conv=${conversation.id} org=${conversation.organizationId} — sem responsável/OWNER; mensagem de transição não enviada`,
        );
        return;
      }

      const contact = await this.prisma.contact.findUnique({
        where: { id: conversation.contactId },
        select: { name: true },
      });
      const text = template.replace(/\{nome\}/g, contact?.name ?? '');

      await this.messages.send(
        {
          conversationId: conversation.id,
          type: 'TEXT',
          content: { text },
        },
        senderId,
        conversation.organizationId,
        'ALL',
        undefined,
        { system: true },
      );
    } catch (err) {
      this.logger.warn(
        `cadence_transition_send_failed enr=${enrollment.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Remetente do sistema: responsável da conversa, senão o OWNER da org. */
  private async resolveSystemSender(
    organizationId: string,
    assignedToId: string | null,
  ): Promise<string | null> {
    if (assignedToId) return assignedToId;
    const owner = await this.prisma.userOrganization.findFirst({
      where: { organizationId, role: 'OWNER' },
      select: { userId: true },
    });
    return owner?.userId ?? null;
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
