import { Injectable, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { ConversationAccessService } from '../messaging/conversations/conversation-access.service';
import type { ChannelAccess } from '../iam/channel-access/channel-access.service';

/** Quem está pedindo: org do JWT, papel, usuário e canais acessíveis. */
export interface ConversationActor {
  organizationId: string;
  role: OrgRole | undefined;
  userId: string;
  channelAccess: ChannelAccess;
}

/**
 * Guarda única para rotas de aceite/contrato ligadas a uma conversa:
 * outra org, conversa de colega (AGENT; vendedor incluído passa) ou canal sem
 * acesso = 404, sem confirmar que a conversa existe.
 */
@Injectable()
export class ConversationGuardService {
  constructor(private readonly conversationAccess: ConversationAccessService) {}

  async assertCanUse(actor: ConversationActor, conversationId: string): Promise<void> {
    const conversation = await this.conversationAccess.assertConversationAccess(
      conversationId,
      actor.organizationId,
      actor.role,
      actor.userId,
      { allowParticipant: true },
    );
    const access = actor.channelAccess;
    if (access !== 'ALL' && !access.has(conversation.channelId)) {
      throw new NotFoundException('Conversation not found');
    }
  }
}
