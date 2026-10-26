import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import {
  ConversationStatus,
  MessageContentType,
  MessageDirection,
  MessageStatus,
  OrgRole,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ConversationsService } from '../messaging/conversations/conversations.service';
import { ChannelAccess } from '../iam/channel-access/channel-access.service';
import { PipelinesService } from './pipelines.service';
import { CadenceRunner } from '../cadences/cadence-runner.service';
import {
  LostRecoveryService,
  type RecoveryPlacement,
} from './lost-recovery.service';
import { pipelineCardScopeWhere } from './pipeline-scope';
import { NOT_LOST_RECOVERY } from './lost-recovery.constants';
import { MoveCardDto } from './dto/pipeline.dto';
import { MarkLostDto } from './dto/lost-sale.dto';
import {
  LOST_REASONS,
  LOST_REASONS_REQUIRING_NOTE,
  type LostReason,
} from './lost-sale.constants';

type JsonObject = Prisma.InputJsonObject;

interface Actor {
  userId: string;
  role?: OrgRole;
  access: ChannelAccess;
}

/** Chaves de `metadata` que guardam o estado anterior, para o desfazer. */
const CONV_FROM_STATUS_KEY = 'lostFromStatus';
const CARD_FROM_STAGE_KEY = 'lostFromStageId';
const CONV_RECOVERY_KEY = 'lostRecovery';

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function without(obj: JsonObject, ...keys: string[]): JsonObject {
  return Object.fromEntries(
    Object.entries(obj).filter(([key]) => !keys.includes(key)),
  ) as JsonObject;
}

function readPlacement(value: unknown): RecoveryPlacement | null {
  const v = asObject(value);
  if (typeof v.cardId !== 'string' || typeof v.created !== 'boolean') return null;
  return {
    cardId: v.cardId,
    created: v.created,
    fromStageId: typeof v.fromStageId === 'string' ? v.fromStageId : null,
  };
}

/**
 * Venda perdida: o vendedor escolhe o motivo e a conversa é encerrada.
 *
 * Grava o motivo na conversa (sempre) e no card do funil (quando existe),
 * movendo o card para a etapa LOST, e põe o lead na coluna do motivo no funil
 * "Recuperação de perdidas". O estado anterior fica em `metadata` para o
 * "Desfazer" do aviso voltar tudo como estava.
 */
@Injectable()
export class LostSaleService {
  private readonly logger = new Logger(LostSaleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly pipelines: PipelinesService,
    // Mesmo ciclo pipelines↔messaging do MessagesService no PipelinesService.
    @Inject(forwardRef(() => ConversationsService))
    private readonly conversations: ConversationsService,
    private readonly recovery: LostRecoveryService,
    @Inject(forwardRef(() => CadenceRunner))
    private readonly cadenceRunner: CadenceRunner,
  ) {}

  async markLost(
    organizationId: string,
    conversationId: string,
    dto: MarkLostDto,
    actor: Actor,
  ) {
    const note = dto.note?.trim() || null;
    if (LOST_REASONS_REQUIRING_NOTE.includes(dto.reason) && !note) {
      throw new BadRequestException('Escreva o motivo em "Outro".');
    }

    const conversation = await this.loadWithAccess(
      organizationId,
      conversationId,
      actor,
    );
    const metadata = asObject(conversation.metadata);
    // Remarcar (trocar o motivo) mantém o estado de antes da primeira marcação.
    const isRemark = !!conversation.lostAt;
    const fromStatus = isRemark
      ? metadata[CONV_FROM_STATUS_KEY]
      : conversation.status;

    await this.moveCardToLost(organizationId, conversationId, dto.reason, actor);

    // lostAt antes da cadência de recuperação: o despachante só envia em
    // conversa encerrada quando ela está marcada como venda perdida.
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lostReason: dto.reason,
        lostNote: note,
        lostAt: new Date(),
        lostById: actor.userId,
        metadata: { ...metadata, [CONV_FROM_STATUS_KEY]: fromStatus },
      },
    });

    const label = LOST_REASONS[dto.reason];
    await this.postSystemMessage(
      conversation,
      actor.userId,
      note ? `❌ Venda perdida: ${label}. ${note}` : `❌ Venda perdida: ${label}`,
      { reason: dto.reason, note },
    );

    if (conversation.status !== ConversationStatus.CLOSED) {
      await this.conversations.close(
        conversationId,
        organizationId,
        actor.userId,
        actor.access,
        actor.role,
      );
    }

    await this.placeInRecovery(conversation, dto.reason, note, {
      organizationId,
      keepPrevious: isRemark,
      metadata: { ...metadata, [CONV_FROM_STATUS_KEY]: fromStatus },
    });

    await this.conversations.broadcastById(conversationId);
    return this.conversations.findOne(conversationId, organizationId, actor.access);
  }

  /**
   * Cadência de vendas não segue num lead perdido — e inscrição viva impediria
   * a cadência da coluna de recuperação. Por isso o stop vem antes do place.
   */
  private async placeInRecovery(
    conversation: { id: string; assignedToId?: string | null },
    reason: LostReason,
    note: string | null,
    opts: { organizationId: string; keepPrevious: boolean; metadata: JsonObject },
  ) {
    await this.cadenceRunner.stopLiveForConversation(conversation.id, 'lost_sale');
    const placement = await this.recovery.place(
      opts.organizationId,
      conversation,
      reason,
      note,
    );
    // Na troca de motivo vale o "antes" da primeira marcação (o Desfazer
    // apaga o card que ela criou, não o devolve à coluna do motivo anterior).
    if (!placement || opts.keepPrevious) return;
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { metadata: { ...opts.metadata, [CONV_RECOVERY_KEY]: { ...placement } } },
    });
  }

  async undoLost(organizationId: string, conversationId: string, actor: Actor) {
    const conversation = await this.loadWithAccess(
      organizationId,
      conversationId,
      actor,
    );
    if (!conversation.lostAt) {
      throw new BadRequestException(
        'Esta conversa não está marcada como venda perdida.',
      );
    }
    const metadata = asObject(conversation.metadata);
    const fromStatus = metadata[CONV_FROM_STATUS_KEY];
    const placement = readPlacement(metadata[CONV_RECOVERY_KEY]);

    await this.restoreCard(organizationId, conversationId, actor);
    // Stop depois de mexer nos cards: devolver um card de coluna pode iniciar a
    // cadência daquela coluna, e ela não pode seguir na conversa reaberta.
    if (placement) await this.recovery.undo(organizationId, placement);
    await this.cadenceRunner.stopLiveForConversation(
      conversationId,
      'lost_sale_undone',
    );

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lostReason: null,
        lostNote: null,
        lostAt: null,
        lostById: null,
        metadata: without(metadata, CONV_FROM_STATUS_KEY, CONV_RECOVERY_KEY),
      },
    });

    await this.postSystemMessage(
      conversation,
      actor.userId,
      '↩️ Venda perdida desfeita',
      { undone: true },
    );

    const wasOpenBefore =
      typeof fromStatus === 'string' && fromStatus !== ConversationStatus.CLOSED;
    if (conversation.status === ConversationStatus.CLOSED && wasOpenBefore) {
      return this.conversations.reopen(
        conversationId,
        organizationId,
        actor.userId,
        actor.access,
        actor.role,
      );
    }
    await this.conversations.broadcastById(conversationId);
    return this.conversations.findOne(conversationId, organizationId, actor.access);
  }

  private async loadWithAccess(
    organizationId: string,
    conversationId: string,
    actor: Actor,
  ) {
    await this.conversations.assertConversationAccess(
      conversationId,
      organizationId,
      actor.role,
      actor.userId,
    );
    return this.conversations.findOne(
      conversationId,
      organizationId,
      actor.access,
    ) as Promise<{
      id: string;
      channelId: string;
      contactId: string;
      assignedToId?: string | null;
      status: ConversationStatus;
      metadata: unknown;
      lostAt?: Date | null;
    }>;
  }

  private findCard(organizationId: string, conversationId: string, actor: Actor) {
    return this.prisma.card.findFirst({
      where: {
        conversationId,
        organizationId,
        ...pipelineCardScopeWhere(actor.role, actor.userId),
        ...NOT_LOST_RECOVERY,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Sem card ou sem etapa LOST no funil, segue só com a conversa. */
  private async moveCardToLost(
    organizationId: string,
    conversationId: string,
    reason: LostReason,
    actor: Actor,
  ) {
    const card = await this.findCard(organizationId, conversationId, actor);
    if (!card) return;

    const lostStage = await this.prisma.pipelineStage.findFirst({
      where: { pipelineId: card.pipelineId, type: 'LOST' },
      orderBy: { order: 'asc' },
    });
    if (!lostStage) {
      this.logger.warn(
        `lost_sale_no_lost_stage pipeline=${card.pipelineId} card=${card.id}`,
      );
      return;
    }

    const metadata = asObject(card.metadata);
    const alreadyThere = card.stageId === lostStage.id;
    await this.prisma.card.update({
      where: { id: card.id },
      data: {
        closedReason: reason,
        metadata: alreadyThere
          ? metadata
          : { ...metadata, [CARD_FROM_STAGE_KEY]: card.stageId },
      },
    });
    if (alreadyThere) return;

    await this.pipelines.moveCard(
      card.id,
      organizationId,
      { toStageId: lostStage.id, toIndex: 0 } as MoveCardDto,
      actor.role,
      actor.userId,
    );
  }

  private async restoreCard(
    organizationId: string,
    conversationId: string,
    actor: Actor,
  ) {
    const card = await this.findCard(organizationId, conversationId, actor);
    if (!card) return;

    const metadata = asObject(card.metadata);
    const fromStageId = metadata[CARD_FROM_STAGE_KEY];
    await this.prisma.card.update({
      where: { id: card.id },
      data: {
        closedReason: null,
        metadata: without(metadata, CARD_FROM_STAGE_KEY),
      },
    });
    if (typeof fromStageId !== 'string') return;

    const stage = await this.prisma.pipelineStage.findFirst({
      where: { id: fromStageId, pipelineId: card.pipelineId },
    });
    if (!stage) return;

    await this.pipelines.moveCard(
      card.id,
      organizationId,
      { toStageId: stage.id, toIndex: 0 } as MoveCardDto,
      actor.role,
      actor.userId,
    );
  }

  /** Linha no histórico da conversa, no mesmo formato da transferência. */
  private async postSystemMessage(
    conversation: { id: string; channelId: string; contactId: string },
    actorId: string,
    text: string,
    lostSale: JsonObject,
  ) {
    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        type: MessageContentType.SYSTEM,
        status: MessageStatus.SENT,
        senderId: actorId,
        sentAt: new Date(),
        content: { text, lostSale },
      },
    });
    this.realtime.emitToChannel(conversation.channelId, 'message:new', {
      message,
      conversationId: conversation.id,
      contactId: conversation.contactId,
    });
    this.realtime.emitToConversation(conversation.id, 'message:new', {
      message,
    });
  }
}
