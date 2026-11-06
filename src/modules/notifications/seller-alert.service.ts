import { Injectable, Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PushKind } from '../push/push.types';
import { NotificationsService } from './notifications.service';

interface ConversationOwner {
  assignedToId: string | null;
  organizationId: string;
  contactName: string;
}

interface AlertSpec {
  type: NotificationType;
  kind: PushKind;
  body: string;
}

const AI_HANDOFF: AlertSpec = {
  type: NotificationType.CONVERSATION_TRANSFERRED,
  kind: 'handoff',
  body: 'A IA passou esta conversa para você',
};
const SELLER_NOTE: AlertSpec = {
  type: NotificationType.CONVERSATION_TRANSFERRED,
  kind: 'seller_note',
  body: 'Recado do plantão nesta conversa',
};

/**
 * Avisos que pedem o vendedor dono da conversa: transferência/atribuição,
 * handoff da IA, recado do plantão e chamado de suporte. Vão para o sino (como
 * todo aviso) e pedem push no aparelho; o push só sai com o Sendtur fechado.
 *
 * Best-effort: nunca lança. Aviso quebrado não pode desfazer a transferência,
 * o recado ou o chamado que já aconteceram.
 */
@Injectable()
export class SellerAlertService {
  private readonly logger = new Logger(SellerAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * A conversa passou a ser de `recipientId` (atribuir, transferir, distribuir).
   * Quem se atribuiu sozinho não é avisado.
   */
  async onConversationAssigned(input: {
    conversationId: string;
    recipientId: string;
    previousAssigneeId: string | null;
    actorId?: string;
  }): Promise<void> {
    if (input.actorId && input.actorId === input.recipientId) return;
    const spec: AlertSpec = input.previousAssigneeId
      ? { type: NotificationType.CONVERSATION_TRANSFERRED, kind: 'handoff', body: 'Conversa transferida para você' }
      : { type: NotificationType.CONVERSATION_ASSIGNED, kind: 'handoff', body: 'Conversa atribuída a você' };
    await this.alert(input.conversationId, spec, input.recipientId);
  }

  /** A IA pediu um humano (transferToHuman) numa conversa que já tem vendedor. */
  async onAiHandoff(conversationId: string): Promise<void> {
    await this.alert(conversationId, AI_HANDOFF);
  }

  /** A Aline de plantão deixou recado para o vendedor (leaveNoteForSeller). */
  async onSellerNote(conversationId: string): Promise<void> {
    await this.alert(conversationId, SELLER_NOTE);
  }

  /** Chamado de suporte NOVO aberto para cliente do vendedor. */
  async onSupportTicket(conversationId: string, ticketNumber: string): Promise<void> {
    await this.alert(conversationId, {
      type: NotificationType.CONVERSATION_TRANSFERRED,
      kind: 'support_ticket',
      body: `Chamado ${ticketNumber} aberto`,
    });
  }

  /** Sem `recipientId`, avisa o dono atual da conversa (se houver). */
  private async alert(conversationId: string, spec: AlertSpec, recipientId?: string): Promise<void> {
    try {
      const owner = await this.loadConversation(conversationId);
      const to = recipientId ?? owner?.assignedToId;
      if (!owner || !to) return;
      await this.notifications.notify({
        recipientId: to,
        organizationId: owner.organizationId,
        type: spec.type,
        title: owner.contactName,
        body: spec.body,
        data: { conversationId, kind: spec.kind },
        push: { kind: spec.kind, contactName: owner.contactName, conversationId },
      });
    } catch (err: any) {
      this.logger.warn(`aviso ao vendedor falhou (não crítico) conv=${conversationId}: ${err?.message ?? err}`);
    }
  }

  private async loadConversation(conversationId: string): Promise<ConversationOwner | null> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        assignedToId: true,
        organizationId: true,
        contact: { select: { name: true, phone: true } },
      },
    });
    if (!conv) return null;
    return {
      assignedToId: conv.assignedToId,
      organizationId: conv.organizationId,
      contactName: conv.contact?.name || conv.contact?.phone || 'Cliente',
    };
  }
}
