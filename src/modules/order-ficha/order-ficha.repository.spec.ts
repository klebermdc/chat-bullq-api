import { OrderFichaRepository } from './order-ficha.repository';

describe('OrderFichaRepository', () => {
  const prisma = {
    orderFicha: {
      upsert: jest.fn().mockResolvedValue({ id: 'f1' }),
      findUnique: jest.fn().mockResolvedValue({ id: 'f1' }),
      update: jest.fn().mockResolvedValue({ id: 'f1' }),
    },
  } as any;
  const repo = new OrderFichaRepository(prisma);

  it('upserts por conversationId', async () => {
    await repo.upsertOrder({
      organizationId: 'o1', contactId: 'c1', conversationId: 'cv1',
      items: [{ produto: 'MK', quantidade: 4 }],
      travelDatesText: 'julho', travelStart: null, travelEnd: null,
      requestedAt: new Date('2026-07-20T10:00:00Z'), sourceMessageId: 'm1',
    });
    expect(prisma.orderFicha.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: 'cv1' } }),
    );
  });

  it('findByConversation busca por conversationId', async () => {
    await repo.findByConversation('cv1');
    expect(prisma.orderFicha.findUnique).toHaveBeenCalledWith({ where: { conversationId: 'cv1' } });
  });

  it('updateDivergences grava divergências + status', async () => {
    await repo.updateDivergences('cv1', [], 'MATCHED' as any, 'p1');
    expect(prisma.orderFicha.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: 'cv1' } }),
    );
  });
});
