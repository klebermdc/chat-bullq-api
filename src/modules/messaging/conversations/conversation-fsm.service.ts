import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { AutomationTrigger, ConversationStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { RatingsService } from '../../ratings/ratings.service';
import { LegacyOwnerWriterService } from '../../carteira-legado/legacy-owner-writer.service';
import { OutboxService } from '../../automations/outbox/outbox.service';
import { syncAttendantTag } from '../../../common/utils/sync-attendant-tag';

type Transition = {
  from: ConversationStatus;
  to: ConversationStatus;
};

const VALID_TRANSITIONS: Transition[] = [
  { from: ConversationStatus.PENDING, to: ConversationStatus.OPEN },
  { from: ConversationStatus.PENDING, to: ConversationStatus.BOT },
  // Encerrar direto da fila: um lead que entrou mas nunca foi assumido
  // pode ser descartado sem precisar ser aberto primeiro.
  { from: ConversationStatus.PENDING, to: ConversationStatus.CLOSED },
  { from: ConversationStatus.BOT, to: ConversationStatus.PENDING },
  { from: ConversationStatus.BOT, to: ConversationStatus.CLOSED },
  { from: ConversationStatus.OPEN, to: ConversationStatus.WAITING },
  { from: ConversationStatus.OPEN, to: ConversationStatus.CLOSED },
  { from: ConversationStatus.WAITING, to: ConversationStatus.OPEN },
  { from: ConversationStatus.WAITING, to: ConversationStatus.CLOSED },
  { from: ConversationStatus.CLOSED, to: ConversationStatus.OPEN },
  { from: ConversationStatus.CLOSED, to: ConversationStatus.PENDING },
];

@Injectable()
export class ConversationFsmService {
  private readonly logger = new Logger(ConversationFsmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ratings: RatingsService,
    private readonly outbox: OutboxService,
    private readonly legacyOwnerWriter: LegacyOwnerWriterService,
  ) {}

  canTransition(from: ConversationStatus, to: ConversationStatus): boolean {
    return VALID_TRANSITIONS.some((t) => t.from === from && t.to === to);
  }

  async transition(
    conversationId: string,
    to: ConversationStatus,
    actorId?: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });

    const from = conversation.status;

    if (!this.canTransition(from, to)) {
      throw new BadRequestException(
        `Invalid transition: ${from} → ${to}`,
      );
    }

    const updateData: Record<string, any> = { status: to };

    if (to === ConversationStatus.CLOSED) {
      updateData.closedAt = new Date();
    }
    if (from === ConversationStatus.CLOSED && to !== ConversationStatus.CLOSED) {
      updateData.closedAt = null;
      updateData.reopenedAt = new Date();
      updateData.reopenedCount = { increment: 1 };
    }

    // Wrap mutation + audit + outbox emit in a single transaction. If
    // anything fails, none of it is visible — the automation engine never
    // sees a status change for a conversation whose update was rolled back.
    await this.prisma.$transaction(async (tx) => {
      await tx.conversation.update({
        where: { id: conversationId },
        data: updateData,
      });

      await tx.conversationAuditLog.create({
        data: {
          conversationId,
          actorId,
          action: 'STATUS_CHANGED',
          fromValue: from,
          toValue: to,
          metadata: metadata || {},
        },
      });

      await this.outbox.enqueue(
        tx,
        AutomationTrigger.CONVERSATION_STATUS_CHANGED,
        {
          organizationId: conversation.organizationId,
          contactId: conversation.contactId,
          conversationId,
          channelId: conversation.channelId,
          actorId,
          fromStatus: from,
          toStatus: to,
        },
      );
    });

    this.logger.log(`Conversation ${conversationId}: ${from} → ${to}`);

    // Só pede avaliação quando houve atendimento humano de verdade. Fechar
    // direto de PENDING/BOT (lead descartado da fila, nunca assumido) não
    // deve disparar pedido de nota ao cliente.
    const wasHumanAttended =
      from === ConversationStatus.OPEN || from === ConversationStatus.WAITING;
    if (to === ConversationStatus.CLOSED && wasHumanAttended) {
      this.ratings.requestRating(conversationId).catch((err) => {
        this.logger.warn(`Failed to request rating for ${conversationId}: ${err?.message}`);
      });
    }
  }

  async assign(
    conversationId: string,
    agentId: string,
    actorId?: string,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });

    const updates: Record<string, any> = { assignedToId: agentId };
    const willAlsoChangeStatus =
      conversation.status === ConversationStatus.PENDING;

    if (willAlsoChangeStatus) {
      updates.status = ConversationStatus.OPEN;
    }

    if (!conversation.firstResponseAt && willAlsoChangeStatus) {
      updates.firstResponseAt = new Date();
    }

    // Same-assignee no-op short-circuits the outbox emit. Without this,
    // every UI re-save would cycle the automation engine.
    const isNoOp = conversation.assignedToId === agentId;

    await this.prisma.$transaction(async (tx) => {
      // Compare-and-set: só grava se o dono ainda for exatamente quem lemos
      // acima (`conversation.assignedToId`, que é `null` quando sem dono). Se
      // dois caminhos concorrentes (assumir / transferir / round-robin) tentam
      // atribuir o mesmo lead, só o primeiro casa o where; o segundo pega
      // count=0 → 409, e a transação inteira aborta (nada de audit/outbox
      // fantasma). Sem isso era last-write-wins silencioso e dois atendentes
      // "ganhavam" o mesmo lead.
      const claimed = await tx.conversation.updateMany({
        where: { id: conversationId, assignedToId: conversation.assignedToId },
        data: updates,
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'A atribuição desta conversa mudou enquanto você agia. Atualize e tente de novo.',
        );
      }

      await tx.conversationAuditLog.create({
        data: {
          conversationId,
          actorId: actorId || agentId,
          action: 'ASSIGNED',
          fromValue: conversation.assignedToId,
          toValue: agentId,
        },
      });

      if (willAlsoChangeStatus) {
        await tx.conversationAuditLog.create({
          data: {
            conversationId,
            actorId: actorId || agentId,
            action: 'STATUS_CHANGED',
            fromValue: ConversationStatus.PENDING,
            toValue: ConversationStatus.OPEN,
          },
        });
      }

      // A etiqueta do vendedor é uma TAG (nome do atendente), não um derivado
      // de assignedToId. Roda mesmo quando o dono não muda: se ele virou dono
      // por um caminho que não tagueava (ex.: respondeu antes), escolher o
      // mesmo vendedor no botão de atribuir tem que fazer a tag aparecer.
      await syncAttendantTag(tx, {
        conversationId,
        contactId: conversation.contactId,
        organizationId: conversation.organizationId,
        fromAssigneeId: conversation.assignedToId,
        toAssigneeId: agentId,
      });

      if (!isNoOp) {
        await this.outbox.enqueue(
          tx,
          AutomationTrigger.CONVERSATION_ASSIGNED,
          {
            organizationId: conversation.organizationId,
            contactId: conversation.contactId,
            conversationId,
            channelId: conversation.channelId,
            actorId: actorId || agentId,
            fromAssigneeId: conversation.assignedToId,
            toAssigneeId: agentId,
          },
        );
      }

      if (willAlsoChangeStatus) {
        await this.outbox.enqueue(
          tx,
          AutomationTrigger.CONVERSATION_STATUS_CHANGED,
          {
            organizationId: conversation.organizationId,
            contactId: conversation.contactId,
            conversationId,
            channelId: conversation.channelId,
            actorId: actorId || agentId,
            fromStatus: ConversationStatus.PENDING,
            toStatus: ConversationStatus.OPEN,
          },
        );
      }
    });

    if (!isNoOp) {
      // Transferir vale como troca de dono: o cliente da carteira legada passa
      // a ser do novo vendedor, senão a próxima conversa nova dele voltaria
      // pro antigo. Best-effort: nunca derruba a atribuição.
      await this.legacyOwnerWriter
        .moveOwner(conversation.contactId, agentId)
        .catch((err: unknown) =>
          this.logger.warn(
            `carteira não atualizada (conv=${conversationId}): ${err instanceof Error ? err.message : err}`,
          ),
        );
    }
  }
}
