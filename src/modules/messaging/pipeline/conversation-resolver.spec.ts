import {
  AutomationTrigger,
  ConversationSource,
  ConversationStatus,
} from '@prisma/client';
import { ConversationResolverService } from './conversation-resolver.service';

describe('ConversationResolverService.resolve', () => {
  const organizationId = 'org-1';
  const channelId = 'ch-1';
  const contactId = 'contact-1';

  const buildService = (prisma: any, outbox: any, attribution?: any) => {
    const idempotency = {
      withLock: (_key: string, fn: () => Promise<any>) => fn(),
    };
    const attributionMock = attribution ?? {
      resolveSource: jest.fn().mockResolvedValue({
        source: ConversationSource.ORGANIC,
        sourceDetail: {},
        matchedLeadIntakeId: null,
      }),
    };
    return new ConversationResolverService(
      prisma as any,
      idempotency as any,
      outbox as any,
      attributionMock as any,
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
      leadIntake: { updateMany: jest.fn().mockResolvedValue({}) },
      contact: { updateMany: jest.fn().mockResolvedValue({}) },
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

  it('CREATE: carimba source/sourceDetail na conversa e faz first-touch no contato', async () => {
    const txMock = {
      conversation: {
        create: jest.fn().mockResolvedValue({
          id: 'conv-new',
          status: ConversationStatus.PENDING,
        }),
      },
      leadIntake: { updateMany: jest.fn().mockResolvedValue({}) },
      contact: { updateMany: jest.fn().mockResolvedValue({}) },
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

    const attribution = {
      resolveSource: jest.fn().mockResolvedValue({
        source: ConversationSource.CTWA,
        sourceDetail: { adId: '120' },
        matchedLeadIntakeId: null,
      }),
    };

    const service = buildService(prisma, outbox, attribution);

    await service.resolve(organizationId, channelId, contactId, false, {
      referral: { sourceId: '120' } as any,
    });

    expect(attribution.resolveSource).toHaveBeenCalledTimes(1);
    expect(txMock.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: ConversationSource.CTWA,
          sourceDetail: { adId: '120' },
        }),
      }),
    );
    expect(txMock.contact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: contactId, source: null },
        data: { source: ConversationSource.CTWA },
      }),
    );
    // Sem LeadIntake casado → não consome nada.
    expect(txMock.leadIntake.updateMany).not.toHaveBeenCalled();
  });

  it('CREATE: consome o LeadIntake casado atomicamente (guard consumedAt:null)', async () => {
    const txMock = {
      conversation: {
        create: jest.fn().mockResolvedValue({
          id: 'conv-new',
          status: ConversationStatus.PENDING,
        }),
      },
      leadIntake: { updateMany: jest.fn().mockResolvedValue({}) },
      contact: { updateMany: jest.fn().mockResolvedValue({}) },
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

    const attribution = {
      resolveSource: jest.fn().mockResolvedValue({
        source: ConversationSource.SITE_FORM,
        sourceDetail: { page: '/x' },
        matchedLeadIntakeId: 'li1',
      }),
    };

    const service = buildService(prisma, outbox, attribution);

    await service.resolve(organizationId, channelId, contactId, false, {
      contactPhone: '+5511999999999',
    });

    expect(txMock.leadIntake.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'li1', consumedAt: null }),
        data: expect.objectContaining({ consumedConversationId: 'conv-new' }),
      }),
    );
    expect(txMock.contact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: contactId, source: null },
        data: { source: ConversationSource.SITE_FORM },
      }),
    );
  });
});
