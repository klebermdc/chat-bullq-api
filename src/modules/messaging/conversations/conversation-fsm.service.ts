import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { AutomationTrigger, ConversationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { RatingsService } from '../../ratings/ratings.service';
import { OutboxService } from '../../automations/outbox/outbox.service';

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
      await tx.conversation.update({
        where: { id: conversationId },
        data: updates,
      });

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

      if (!isNoOp) {
        // A etiqueta do atendente no card é uma TAG de conversa (nome do
        // atendente), não um derivado de assignedToId. Ao trocar de atendente
        // precisamos sincronizar: tirar a tag do antigo e pôr a do novo —
        // senão a tag do atendente anterior fica colada pra sempre.
        await this.syncAttendantTag(
          tx,
          conversationId,
          conversation.organizationId,
          conversation.assignedToId,
          agentId,
        );

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
  }

  /**
   * Mantém a tag do atendente do card em sincronia com quem está atribuído.
   * A tag é o NOME do atendente (mesma convenção do fluxo de distribuir):
   * remove a do atendente anterior (match exato pelo nome) e adiciona a do
   * novo (idempotente). Roda dentro da mesma transação do assign.
   */
  private async syncAttendantTag(
    tx: Prisma.TransactionClient,
    conversationId: string,
    organizationId: string,
    fromAssigneeId: string | null,
    toAssigneeId: string,
  ): Promise<void> {
    // Tira a tag do atendente anterior. Casa exatamente pelo nome dele — que é
    // justamente a tag que o fluxo de distribuir teria criado.
    if (fromAssigneeId && fromAssigneeId !== toAssigneeId) {
      const prev = await tx.user.findUnique({
        where: { id: fromAssigneeId },
        select: { name: true },
      });
      const prevName = (prev?.name ?? '').trim();
      if (prevName) {
        await tx.conversationTag.deleteMany({
          where: {
            conversationId,
            tag: { organizationId, name: prevName },
          },
        });
      }
    }

    // Adiciona a tag do novo atendente (cria a Tag se não existir).
    const next = await tx.user.findUnique({
      where: { id: toAssigneeId },
      select: { name: true },
    });
    const nextName = (next?.name ?? '').trim();
    if (!nextName) return;

    const tag = await tx.tag.upsert({
      where: { organizationId_name: { organizationId, name: nextName } },
      create: { organizationId, name: nextName },
      update: {},
      select: { id: true },
    });
    await tx.conversationTag.upsert({
      where: { conversationId_tagId: { conversationId, tagId: tag.id } },
      create: { conversationId, tagId: tag.id },
      update: {},
    });
  }
}
