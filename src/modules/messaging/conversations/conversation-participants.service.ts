import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  MessageContentType,
  MessageDirection,
  MessageStatus,
  NotificationType,
  OrgRole,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  ChannelAccess,
  ChannelAccessService,
} from '../../iam/channel-access/channel-access.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  addParticipantTag,
  removeParticipantTag,
} from '../../../common/utils/sync-attendant-tag';
import { ConversationAccessService } from './conversation-access.service';
import { ConversationsService } from './conversations.service';

const PARTICIPANT_SELECT = {
  userId: true,
  createdAt: true,
  user: { select: { id: true, name: true, avatarUrl: true } },
  addedBy: { select: { id: true, name: true } },
} satisfies Prisma.ConversationParticipantSelect;

/** Quem fez a ação e com que papel/acesso — o mesmo trio das outras rotas. */
export interface ParticipantActor {
  userId: string;
  role: OrgRole;
  access: ChannelAccess;
}

/**
 * Conversa compartilhada: um vendedor inclui outro na conversa (ex.: Renata
 * inclui o Kleber). O incluído vê e responde, mas o dono não muda — SLA,
 * placar, push e aba Esperando continuam do `assignedToId`.
 *
 * Regras:
 * - Incluir: qualquer um que alcance a conversa (dono, incluído, ADM/Owner).
 *   O incluído precisa ser membro ativo e ter acesso ao canal da conversa.
 * - Remover: a própria pessoa (sair), o dono da conversa ou ADM/Owner.
 */
@Injectable()
export class ConversationParticipantsService {
  private readonly logger = new Logger(ConversationParticipantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ConversationAccessService,
    private readonly channelAccess: ChannelAccessService,
    private readonly conversations: ConversationsService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  async list(conversationId: string, organizationId: string, actor: ParticipantActor) {
    await this.reachableConversation(conversationId, organizationId, actor);
    return this.prisma.conversationParticipant.findMany({
      where: { conversationId },
      select: PARTICIPANT_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async add(
    conversationId: string,
    organizationId: string,
    targetUserId: string,
    actor: ParticipantActor,
  ) {
    const conversation = await this.reachableConversation(
      conversationId,
      organizationId,
      actor,
    );
    if (conversation.assignedToId === targetUserId) {
      throw new BadRequestException('Este vendedor já é o dono da conversa.');
    }
    const target = await this.eligibleMember(
      organizationId,
      targetUserId,
      conversation.channelId,
    );

    try {
      await this.prisma.conversationParticipant.create({
        data: { conversationId, userId: targetUserId, addedById: actor.userId },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new BadRequestException('Este vendedor já está na conversa.');
      }
      throw err;
    }

    const tagScope = { conversationId, organizationId, userId: targetUserId };
    await addParticipantTag(this.prisma, tagScope);

    const actorName = await this.userName(actor.userId);
    await this.postSystemMessage(
      conversation,
      actor.userId,
      `👥 ${actorName} incluiu ${target.name} na conversa`,
    );
    await this.conversations.broadcastById(conversationId);
    if (targetUserId !== actor.userId) {
      await this.notifyIncluded(conversation, organizationId, targetUserId, actorName);
    }
    return this.list(conversationId, organizationId, actor);
  }

  async remove(
    conversationId: string,
    organizationId: string,
    targetUserId: string,
    actor: ParticipantActor,
  ) {
    const conversation = await this.reachableConversation(
      conversationId,
      organizationId,
      actor,
    );
    const isSelf = targetUserId === actor.userId;
    const isOwner = conversation.assignedToId === actor.userId;
    const isManager = this.channelAccess.isBypassRole(actor.role);
    if (!isSelf && !isOwner && !isManager) {
      throw new ForbiddenException(
        'Só o dono da conversa ou a gestão podem remover outro vendedor.',
      );
    }

    const { count } = await this.prisma.conversationParticipant.deleteMany({
      where: { conversationId, userId: targetUserId },
    });
    if (count === 0) {
      throw new NotFoundException('Este vendedor não está na conversa.');
    }

    await removeParticipantTag(this.prisma, {
      conversationId,
      organizationId,
      userId: targetUserId,
    });

    const targetName = await this.userName(targetUserId);
    const text = isSelf
      ? `👋 ${targetName} saiu da conversa`
      : `👥 ${await this.userName(actor.userId)} removeu ${targetName} da conversa`;
    await this.postSystemMessage(conversation, actor.userId, text);
    await this.conversations.broadcastById(conversationId);
    return { removed: true };
  }

  /**
   * Avisa quem foi incluído (sino + push, conforme as preferências dele).
   * Falha no aviso não desfaz a inclusão: só registra no log.
   */
  private async notifyIncluded(
    conversation: { id: string; contactId: string },
    organizationId: string,
    recipientId: string,
    actorName: string,
  ) {
    try {
      const contact = await this.prisma.contact.findUnique({
        where: { id: conversation.contactId },
        select: { name: true, phone: true },
      });
      const client = contact?.name || contact?.phone || 'um cliente';
      await this.notifications.notify({
        recipientId,
        organizationId,
        type: NotificationType.CONVERSATION_ASSIGNED,
        title: 'Você foi incluído numa conversa',
        body: `${actorName} incluiu você na conversa com ${client}.`,
        data: { conversationId: conversation.id, kind: 'participant_added' },
      });
    } catch (err) {
      this.logger.warn(
        `Aviso de inclusão falhou (conv ${conversation.id}, user ${recipientId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Carrega a conversa já checando org, canal e dono/incluído. */
  private async reachableConversation(
    conversationId: string,
    organizationId: string,
    actor: ParticipantActor,
  ) {
    const conversation = await this.access.assertConversationAccess(
      conversationId,
      organizationId,
      actor.role,
      actor.userId,
      { allowParticipant: true },
    );
    this.channelAccess.assertChannelAccess(actor.access, conversation.channelId);
    return conversation;
  }

  /**
   * Membro ativo da org que enxerga o canal da conversa. Sem o canal ele não
   * receberia as mensagens em tempo real nem conseguiria abrir o chat.
   */
  private async eligibleMember(
    organizationId: string,
    userId: string,
    channelId: string,
  ) {
    const membership = await this.prisma.userOrganization.findFirst({
      where: { organizationId, userId, user: { isActive: true } },
      select: { id: true, role: true, user: { select: { name: true } } },
    });
    if (!membership) {
      throw new NotFoundException('Vendedor não encontrado na organização.');
    }
    const channels = await this.channelAccess.getAccessibleChannelIds(
      membership.id,
      membership.role,
      organizationId,
    );
    if (channels !== 'ALL' && !channels.has(channelId)) {
      throw new BadRequestException(
        'Este vendedor não tem acesso ao canal desta conversa.',
      );
    }
    return { name: membership.user.name };
  }

  private async userName(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return user?.name ?? 'Atendente';
  }

  /**
   * Registro no thread, visível à equipe. SYSTEM com status SENT e fora da
   * fila de entrega: NÃO vai para o cliente no WhatsApp/IG.
   */
  private async postSystemMessage(
    conversation: { id: string; channelId: string; contactId: string },
    actorId: string,
    text: string,
  ) {
    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        type: MessageContentType.SYSTEM,
        status: MessageStatus.SENT,
        senderId: actorId,
        sentAt: new Date(),
        content: { text },
      },
    });
    this.realtime.emitToChannel(conversation.channelId, 'message:new', {
      message,
      conversationId: conversation.id,
      contactId: conversation.contactId,
    });
    this.realtime.emitToConversation(conversation.id, 'message:new', { message });
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}
