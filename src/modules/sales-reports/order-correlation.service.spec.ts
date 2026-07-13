import { OrderCorrelationService } from './order-correlation.service';

/**
 * E5.2a — Correlação exata: casa cards Ganhos (WON) que têm nº do pedido
 * (metadata.orderNumber, gravado no E5.1) com o pedido real do HUB
 * (OfpSalesOrder.pedido). Match → liga (grava ofpOrderExternalId) + enriquece o
 * valor do card. Idempotente.
 */
function make(opts: { wonCards?: any[]; order?: any } = {}) {
  const prisma = {
    card: {
      findMany: jest.fn().mockResolvedValue(opts.wonCards ?? []),
      update: jest.fn().mockResolvedValue({}),
    },
    ofpSalesOrder: {
      findFirst: jest.fn().mockResolvedValue(
        opts.order === undefined
          ? { externalId: 'ext-9', pedido: 'PED-1', venda: 4200 }
          : opts.order,
      ),
    },
  } as any;
  return { service: new OrderCorrelationService(prisma), prisma };
}

describe('OrderCorrelationService.correlateWonCards (E5.2a)', () => {
  it('casa card Ganho com o pedido do HUB — grava ofpOrderExternalId + valor', async () => {
    const { service, prisma } = make({
      wonCards: [
        { id: 'card-1', status: 'WON', metadata: { orderNumber: 'PED-1' } },
      ],
    });
    const res = await service.correlateWonCards();

    expect(prisma.ofpSalesOrder.findFirst).toHaveBeenCalledWith({
      where: { pedido: 'PED-1' },
    });
    const upd = prisma.card.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'card-1' });
    expect(upd.data.metadata).toMatchObject({
      orderNumber: 'PED-1',
      ofpOrderExternalId: 'ext-9',
    });
    expect(upd.data.value).toBe(4200);
    expect(res).toEqual({ matched: 1, checked: 1 });
  });

  it('idempotente: card já correlacionado não é atualizado de novo', async () => {
    const { service, prisma } = make({
      wonCards: [
        {
          id: 'card-1',
          status: 'WON',
          metadata: { orderNumber: 'PED-1', ofpOrderExternalId: 'ext-9' },
        },
      ],
    });
    const res = await service.correlateWonCards();

    expect(prisma.ofpSalesOrder.findFirst).not.toHaveBeenCalled();
    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(res.matched).toBe(0);
  });

  it('card com nº mas sem pedido correspondente no HUB → não atualiza', async () => {
    const { service, prisma } = make({
      wonCards: [
        { id: 'card-1', status: 'WON', metadata: { orderNumber: 'PED-X' } },
      ],
      order: null,
    });
    const res = await service.correlateWonCards();

    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(res).toEqual({ matched: 0, checked: 1 });
  });

  it('card Ganho SEM nº do pedido é ignorado (nem consulta o HUB)', async () => {
    const { service, prisma } = make({
      wonCards: [{ id: 'card-1', status: 'WON', metadata: {} }],
    });
    const res = await service.correlateWonCards();

    expect(prisma.ofpSalesOrder.findFirst).not.toHaveBeenCalled();
    expect(res).toEqual({ matched: 0, checked: 0 });
  });
});
