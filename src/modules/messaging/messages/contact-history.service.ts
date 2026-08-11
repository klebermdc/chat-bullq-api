import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  ChannelAccess,
  ChannelAccessService,
} from '../../iam/channel-access/channel-access.service';
import { resolveAssignmentScope } from '../conversations/conversation-scope';
import { phoneVariants } from './phone-identity';

/** O cabeçalho de um atendimento, usado nas divisórias da timeline. */
export interface ConversationBrief {
  protocol: string | null;
  channelName: string;
  startedAt: Date;
}

export interface ContactHistoryScope {
  /** Todas as conversas visíveis do cliente, a atual inclusive. */
  conversationIds: string[];
  /** As mesmas, sem a atual — é o que o botão do chat oferece. */
  previousConversationIds: string[];
  /** Atendimentos que existem mas ficaram fora por permissão de canal. */
  hiddenByChannelAccess: number;
  conversations: Record<string, ConversationBrief>;
}

export interface ContactHistoryAvailability {
  previousConversations: number;
  oldestAt: Date | null;
  hiddenByChannelAccess: number;
}

/**
 * Reúne o histórico de um cliente que o modelo de dados espalhou.
 *
 * Uma conversa cobre um atendimento, não um cliente: encerrar e o cliente voltar
 * depois de 24h cria conversa nova, e cada número (canal) tem as suas. Pior, o
 * contato é resolvido por `(channelId, externalId)`, então a mesma pessoa em dois
 * números é dois `Contact` — daí o casamento por telefone.
 *
 * Permissão: a conversa de ENTRADA passa pela checagem completa de sempre (org,
 * canal e atribuição); sem isso um Operador leria conversa alheia só passando o
 * id. As conversas ANTERIORES dispensam a checagem de atribuição — ler o que o
 * cliente já falou é o objetivo da feature — mas nunca a de canal, que continua
 * sendo fronteira dura.
 */
@Injectable()
export class ContactHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  async resolveScope(
    conversationId: string,
    organizationId: string,
    access: ChannelAccess,
    currentUserId?: string,
    role?: OrgRole,
  ): Promise<ContactHistoryScope> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: { select: { id: true, phone: true } } },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.organizationId !== organizationId) {
      throw new ForbiddenException();
    }
    this.channelAccess.assertChannelAccess(access, conversation.channelId);
    if (
      currentUserId &&
      resolveAssignmentScope(role, currentUserId) &&
      conversation.assignedToId !== currentUserId
    ) {
      throw new ForbiddenException();
    }

    const contactIds = await this.siblingContactIds(
      organizationId,
      conversation.contact,
    );

    const found = await this.prisma.conversation.findMany({
      where: {
        organizationId,
        contactId: { in: contactIds },
        deletedAt: null,
      },
      select: {
        id: true,
        protocol: true,
        channelId: true,
        createdAt: true,
        channel: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const visible = found.filter((c) =>
      this.channelAccess.hasAccess(access, c.channelId),
    );

    const conversations: Record<string, ConversationBrief> = {};
    for (const c of visible) {
      conversations[c.id] = {
        protocol: c.protocol,
        channelName: c.channel.name,
        startedAt: c.createdAt,
      };
    }

    const conversationIds = visible.map((c) => c.id);
    return {
      conversationIds,
      previousConversationIds: conversationIds.filter((id) => id !== conversationId),
      hiddenByChannelAccess: found.length - visible.length,
      conversations,
    };
  }

  async availability(
    conversationId: string,
    organizationId: string,
    access: ChannelAccess,
    currentUserId?: string,
    role?: OrgRole,
  ): Promise<ContactHistoryAvailability> {
    const scope = await this.resolveScope(
      conversationId,
      organizationId,
      access,
      currentUserId,
      role,
    );

    const startDates = scope.previousConversationIds.map(
      (id) => scope.conversations[id].startedAt,
    );

    return {
      previousConversations: scope.previousConversationIds.length,
      oldestAt: startDates.length
        ? new Date(Math.min(...startDates.map((d) => d.getTime())))
        : null,
      hiddenByChannelAccess: scope.hiddenByChannelAccess,
    };
  }

  /**
   * Contatos que são a mesma pessoa. Sem telefone gravado não dá para afirmar
   * isso de ninguém, então o escopo encolhe para o próprio contato em vez de
   * chutar por nome — dois "João" na mesma org não são o mesmo cliente.
   */
  private async siblingContactIds(
    organizationId: string,
    contact: { id: string; phone: string | null },
  ): Promise<string[]> {
    const variants = phoneVariants(contact.phone);
    if (variants.length === 0) return [contact.id];

    const siblings = await this.prisma.contact.findMany({
      where: { organizationId, deletedAt: null, phone: { in: variants } },
      select: { id: true },
    });

    return [...new Set([contact.id, ...siblings.map((c) => c.id)])];
  }
}
