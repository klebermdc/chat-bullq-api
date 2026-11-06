import { Injectable, Logger } from '@nestjs/common';
import { AutomationTrigger, ConversationStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { OutboxService } from '../../automations/outbox/outbox.service';
import { IdempotencyService } from './idempotency.service';

export interface ResolvedConversation {
  conversationId: string;
  status: ConversationStatus;
  isNew: boolean;
  wasReopened: boolean;
  /** Reaberta mantendo o atendente que escreveu depois de finalizar. */
  keptAssignee?: boolean;
}

/** Janela em que a resposta do cliente reabre a conversa finalizada. */
const REOPEN_WINDOW_MS = 24 * 60 * 60 * 1000;

const OPEN_STATES = [
  ConversationStatus.PENDING,
  ConversationStatus.OPEN,
  ConversationStatus.BOT,
  ConversationStatus.WAITING,
] as const;

@Injectable()
export class ConversationResolverService {
  private readonly logger = new Logger(ConversationResolverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly outbox: OutboxService,
  ) {}

  async resolve(
    organizationId: string,
    channelId: string,
    contactId: string,
    isGroup?: boolean,
  ): Promise<ResolvedConversation> {
    // Fast path without lock — most webhooks hit an already-open conversation.
    const fast = await this.findOpen(organizationId, channelId, contactId);
    if (fast) return this.touchOpen(fast, isGroup);

    // Need to create or reopen — serialise to prevent duplicate conversations.
    return this.idempotency.withLock(
      `conv:${channelId}:${contactId}`,
      async () => {
        const existing = await this.findOpen(organizationId, channelId, contactId);
        if (existing) return this.touchOpen(existing, isGroup);

        // Ordena pela atividade: se o atendente mandou um template numa
        // conversa finalizada antiga, é ELA que o cliente está respondendo,
        // mesmo que outra tenha sido finalizada mais recentemente.
        const lastClosed = await this.prisma.conversation.findFirst({
          where: {
            organizationId,
            channelId,
            contactId,
            status: ConversationStatus.CLOSED,
          },
          orderBy: [
            { lastMessageAt: { sort: 'desc', nulls: 'last' } },
            { closedAt: 'desc' },
          ],
        });

        if (lastClosed) {
          const reopened = await this.tryReopen(lastClosed);
          if (reopened) return reopened;
        }

        const protocol = this.generateProtocol();
        // Cria a conversa, o audit log e enfileira o evento CONVERSATION_CREATED
        // na MESMA transação: o evento só "existe" se a criação commitar.
        const conversation = await this.prisma.$transaction(async (tx) => {
          const created = await tx.conversation.create({
            data: {
              organizationId,
              channelId,
              contactId,
              status: ConversationStatus.PENDING,
              protocol,
              isGroup: isGroup || false,
            },
          });
          await tx.conversationAuditLog.create({
            data: {
              conversationId: created.id,
              action: 'CREATED',
              toValue: ConversationStatus.PENDING,
            },
          });
          await this.outbox.enqueue(tx, AutomationTrigger.CONVERSATION_CREATED, {
            organizationId,
            contactId,
            conversationId: created.id,
            channelId,
          });
          return created;
        });
        this.logger.log(
          `New conversation created: ${conversation.id} (protocol: ${protocol})`,
        );
        return {
          conversationId: conversation.id,
          status: ConversationStatus.PENDING,
          isNew: true,
          wasReopened: false,
        };
      },
    );
  }

  /**
   * Reabre a conversa finalizada quando:
   *  - foi finalizada há menos de 24h (regra antiga), ou
   *  - o atendente escreveu nela DEPOIS de finalizar (template de retomada)
   *    há menos de 24h — o cliente está respondendo esse envio, e a resposta
   *    tem que cair na mesma conversa, não numa nova.
   * No segundo caso quem mandou continua dono; no primeiro, volta sem dono.
   */
  private async tryReopen(lastClosed: {
    id: string;
    closedAt: Date | null;
    updatedAt: Date;
    lastOutboundAt: Date | null;
  }): Promise<ResolvedConversation | null> {
    const closedAt = lastClosed.closedAt ?? lastClosed.updatedAt;
    const outboundAt = lastClosed.lastOutboundAt ?? null;
    const reachedOutAfterClose =
      outboundAt !== null && outboundAt.getTime() > closedAt.getTime();
    const lastActivity = reachedOutAfterClose && outboundAt ? outboundAt : closedAt;
    if (Date.now() - lastActivity.getTime() >= REOPEN_WINDOW_MS) return null;

    await this.prisma.conversation.update({
      where: { id: lastClosed.id },
      data: {
        status: ConversationStatus.PENDING,
        closedAt: null,
        ...(reachedOutAfterClose ? {} : { assignedToId: null }),
      },
    });
    await this.prisma.conversationAuditLog.create({
      data: {
        conversationId: lastClosed.id,
        action: 'REOPENED',
        fromValue: ConversationStatus.CLOSED,
        toValue: ConversationStatus.PENDING,
        metadata: {
          trigger: reachedOutAfterClose
            ? 'reply_to_outreach_after_close'
            : 'new_inbound_message',
        },
      },
    });
    this.logger.log(`Conversation reopened: ${lastClosed.id}`);
    return {
      conversationId: lastClosed.id,
      status: ConversationStatus.PENDING,
      isNew: false,
      wasReopened: true,
      keptAssignee: reachedOutAfterClose,
    };
  }

  private async findOpen(
    organizationId: string,
    channelId: string,
    contactId: string,
  ) {
    return this.prisma.conversation.findFirst({
      where: {
        organizationId,
        channelId,
        contactId,
        status: { in: Array.from(OPEN_STATES) },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async touchOpen(
    openConversation: {
      id: string;
      status: ConversationStatus;
      isGroup: boolean;
    },
    isGroup?: boolean,
  ): Promise<ResolvedConversation> {
    if (isGroup && !openConversation.isGroup) {
      await this.prisma.conversation.update({
        where: { id: openConversation.id },
        data: { isGroup: true },
      });
    }

    if (openConversation.status === ConversationStatus.WAITING) {
      await this.prisma.conversation.update({
        where: { id: openConversation.id },
        data: { status: ConversationStatus.OPEN },
      });
      await this.prisma.conversationAuditLog.create({
        data: {
          conversationId: openConversation.id,
          action: 'STATUS_CHANGED',
          fromValue: ConversationStatus.WAITING,
          toValue: ConversationStatus.OPEN,
          metadata: { trigger: 'customer_replied' },
        },
      });
      return {
        conversationId: openConversation.id,
        status: ConversationStatus.OPEN,
        isNew: false,
        wasReopened: false,
      };
    }

    return {
      conversationId: openConversation.id,
      status: openConversation.status,
      isNew: false,
      wasReopened: false,
    };
  }

  private generateProtocol(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${date}-${rand}`;
  }
}
