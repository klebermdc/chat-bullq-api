import { AutomationTrigger, ConversationStatus } from '@prisma/client';
import { ConversationResolverService } from './conversation-resolver.service';

describe('ConversationResolverService.resolve', () => {
  const organizationId = 'org-1';
  const channelId = 'ch-1';
  const contactId = 'contact-1';

  const buildService = (prisma: any, outbox: any) => {
    const idempotency = {
      withLock: (_key: string, fn: () => Promise<any>) => fn(),
    };
    return new ConversationResolverService(
      prisma as any,
      idempotency as any,
      outbox as any,
    );
  };

  it('CREATE: emits CONVERSATION_CREATED once with the expected payload and returns isNew', async () => {
    const txMock = {
      conversation: {
        create: jest.fn().mockResolvedValue({
          id: 'conv-new',
          status: ConversationStatus.PENDING,
        }),
      },
      conversationAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };

    const prisma = {
      conversation: {
        // fast-path findOpen -> null, locked findOpen -> null, lastClosed -> null
        findFirst: jest.fn().mockResolvedValue(null),
      },
      conversationAuditLog: { create: jest.fn() },
      $transaction: jest.fn((fn: any) => fn(txMock)),
    };

    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const service = buildService(prisma, outbox);

    const result = await service.resolve(organizationId, channelId, contactId);

    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    const [, trigger, payload] = outbox.enqueue.mock.calls[0];
    expect(trigger).toBe(AutomationTrigger.CONVERSATION_CREATED);
    expect(payload).toMatchObject({
      organizationId,
      contactId,
      conversationId: 'conv-new',
      channelId,
    });
    expect(result.isNew).toBe(true);
  });

  it('REOPEN: does not emit any event when a recently-closed conversation is reopened', async () => {
    const lastClosed = {
      id: 'conv-closed',
      status: ConversationStatus.CLOSED,
      closedAt: new Date(Date.now() - 3600_000), // ~1h ago -> < 24h
      updatedAt: new Date(Date.now() - 3600_000),
    };

    const findFirst = jest
      .fn()
      // fast-path findOpen -> null
      .mockResolvedValueOnce(null)
      // locked findOpen -> null
      .mockResolvedValueOnce(null)
      // lastClosed lookup -> recently-closed conversation
      .mockResolvedValueOnce(lastClosed);

    const prisma = {
      conversation: {
        findFirst,
        update: jest.fn().mockResolvedValue({}),
      },
      conversationAuditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };

    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const service = buildService(prisma, outbox);

    const result = await service.resolve(organizationId, channelId, contactId);

    expect(outbox.enqueue).not.toHaveBeenCalled();
    expect(result.wasReopened).toBe(true);
  });

  const HOUR = 3600_000;
  const DAY = 24 * HOUR;

  const buildReopenPrisma = (lastClosed: Record<string, unknown> | null) => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null) // fast-path findOpen
      .mockResolvedValueOnce(null) // locked findOpen
      .mockResolvedValueOnce(lastClosed); // lastClosed lookup
    const txMock = {
      conversation: {
        create: jest.fn().mockResolvedValue({ id: 'conv-new' }),
      },
      conversationAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    return {
      conversation: { findFirst, update: jest.fn().mockResolvedValue({}) },
      conversationAuditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((fn: any) => fn(txMock)),
      txMock,
    };
  };

  it('reabre conversa finalizada há meses quando o atendente mandou template nela agora', async () => {
    // Arrange: finalizada em agosto, template enviado há 2 minutos.
    const prisma = buildReopenPrisma({
      id: 'conv-antiga',
      status: ConversationStatus.CLOSED,
      closedAt: new Date(Date.now() - 90 * DAY),
      updatedAt: new Date(Date.now() - 2 * 60_000),
      lastOutboundAt: new Date(Date.now() - 2 * 60_000),
      assignedToId: 'user-rafael',
    });
    const outbox = { enqueue: jest.fn() };
    const service = buildService(prisma, outbox);

    // Act: o cliente responde ao template.
    const result = await service.resolve(organizationId, channelId, contactId);

    // Assert: mesma conversa, sem criar outra, e o atendente continua dono.
    expect(result).toMatchObject({
      conversationId: 'conv-antiga',
      isNew: false,
      wasReopened: true,
      keptAssignee: true,
    });
    expect(prisma.txMock.conversation.create).not.toHaveBeenCalled();
    const updateData = prisma.conversation.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('assignedToId');
    expect(updateData.status).toBe(ConversationStatus.PENDING);
  });

  it('busca a última finalizada pela atividade mais recente, não só pela data de finalização', async () => {
    const prisma = buildReopenPrisma(null);
    const service = buildService(prisma, { enqueue: jest.fn() });

    await service.resolve(organizationId, channelId, contactId);

    const lastClosedQuery = prisma.conversation.findFirst.mock.calls[2][0];
    expect(lastClosedQuery.orderBy).toEqual([
      { lastMessageAt: { sort: 'desc', nulls: 'last' } },
      { closedAt: 'desc' },
    ]);
  });

  it('cria conversa nova quando a finalizada é antiga e ninguém escreveu nela depois', async () => {
    const closedAt = new Date(Date.now() - 90 * DAY);
    const prisma = buildReopenPrisma({
      id: 'conv-antiga',
      status: ConversationStatus.CLOSED,
      closedAt,
      updatedAt: closedAt,
      lastOutboundAt: new Date(closedAt.getTime() - HOUR),
      assignedToId: 'user-renata',
    });
    const service = buildService(prisma, { enqueue: jest.fn() });

    const result = await service.resolve(organizationId, channelId, contactId);

    expect(result.isNew).toBe(true);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('reabertura comum (<24h, sem envio depois de finalizar) continua tirando o atendente', async () => {
    const closedAt = new Date(Date.now() - HOUR);
    const prisma = buildReopenPrisma({
      id: 'conv-recente',
      status: ConversationStatus.CLOSED,
      closedAt,
      updatedAt: closedAt,
      lastOutboundAt: new Date(closedAt.getTime() - 60_000),
      assignedToId: 'user-renata',
    });
    const service = buildService(prisma, { enqueue: jest.fn() });

    const result = await service.resolve(organizationId, channelId, contactId);

    expect(result).toMatchObject({ wasReopened: true, keptAssignee: false });
    expect(prisma.conversation.update.mock.calls[0][0].data.assignedToId).toBeNull();
  });
});
