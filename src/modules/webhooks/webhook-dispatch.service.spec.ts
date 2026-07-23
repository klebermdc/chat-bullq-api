import { WebhookDispatchService } from './webhook-dispatch.service';

describe('WebhookDispatchService', () => {
  const build = () => {
    const prisma = {
      webhookSubscription: { findMany: jest.fn().mockResolvedValue([{ id: 'sub1' }, { id: 'sub2' }]) },
      webhookDelivery: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => ({ id: `del-${data.subscriptionId}`, ...data })),
      },
    };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const leadQualified = {
      build: jest.fn().mockResolvedValue({ event: 'LEAD_QUALIFIED' }),
    };
    return {
      prisma,
      queue,
      leadQualified,
      service: new WebhookDispatchService(
        prisma as any,
        queue as any,
        leadQualified as any,
      ),
    };
  };

  const event = { outboxEventId: 'evt1', organizationId: 'o', trigger: 'MESSAGE_RECEIVED', payload: { contactId: 'c', conversationId: 'cv', channelId: 'ch', messageId: 'm' } };

  it('cria uma delivery e enfileira um job por subscription ativa', async () => {
    const { prisma, queue, service } = build();
    await service.dispatch(event as any);
    expect(prisma.webhookSubscription.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'o', isActive: true, events: { has: 'MESSAGE_RECEIVED' } },
    });
    expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('usa jobId idempotente subscriptionId:outboxEventId', async () => {
    const { queue, service } = build();
    await service.dispatch(event as any);
    const opts = queue.add.mock.calls[0][2];
    expect(opts.jobId).toBe('sub1:evt1');
  });

  it('não faz nada quando não há subscription casando', async () => {
    const { prisma, queue, service } = build();
    prisma.webhookSubscription.findMany.mockResolvedValue([]);
    await service.dispatch(event as any);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('é idempotente: pula subscription que já tem delivery para o mesmo outbox event', async () => {
    const { prisma, queue, service } = build();
    // sub1 já entregou este outbox event (retry do automation job); sub2 não.
    prisma.webhookDelivery.findFirst.mockImplementation(({ where }: any) =>
      where.subscriptionId === 'sub1' ? { id: 'del-existente' } : null,
    );
    await service.dispatch(event as any);
    // Só sub2 gera nova delivery + job; sub1 é pulada (sem POST duplicado).
    expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(1);
    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ subscriptionId: 'sub2' }) }),
    );
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][2].jobId).toBe('sub2:evt1');
  });
});
