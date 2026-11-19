import { OrderCorrelationService } from './order-correlation.service';

/**
 * E5.2a — Correlação: casa cards Ganhos (WON) com o pedido real do HUB
 * (OfpSalesOrder) e copia o valor da venda para o card. Pelo nº digitado
 * (tolerante a texto livre) e, sem nº que case, pelo contato. Idempotente.
 */
const NOW = new Date('2026-11-19T12:00:00Z');
const CLOSED = new Date('2026-11-13T12:00:00Z');

function card(overrides: Record<string, any> = {}) {
  return {
    id: 'card-1',
    value: null,
    closedAt: CLOSED,
    metadata: {},
    contact: { phone: '5518991274666', email: null },
    ...overrides,
  };
}

function make(opts: { wonCards?: any[]; order?: any; contactOrders?: any[] } = {}) {
  const prisma = {
    card: {
      findMany: jest.fn().mockResolvedValue(opts.wonCards ?? []),
      update: jest.fn().mockResolvedValue({}),
    },
    ofpSalesOrder: {
      findFirst: jest.fn().mockResolvedValue(
        opts.order === undefined ? { externalId: 'ext-9', venda: 4200 } : opts.order,
      ),
    },
    $queryRaw: jest.fn().mockResolvedValue(opts.contactOrders ?? []),
  } as any;
  return { service: new OrderCorrelationService(prisma), prisma };
}

describe('OrderCorrelationService.correlateWonCards', () => {
  it('casa pelo nº do pedido — grava ofpOrderExternalId + valor', async () => {
    const { service, prisma } = make({
      wonCards: [card({ value: 100, metadata: { orderNumber: 'PED-1' } })],
    });
    const res = await service.correlateWonCards(NOW);

    const where = prisma.ofpSalesOrder.findFirst.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ pedido: { equals: 'PED-1', mode: 'insensitive' } });
    const upd = prisma.card.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'card-1' });
    expect(upd.data.metadata).toMatchObject({
      orderNumber: 'PED-1',
      ofpOrderExternalId: 'ext-9',
      correlatedBy: 'order_number',
    });
    expect(upd.data.value).toBe(4200);
    expect(res).toEqual({ matched: 1, checked: 1 });
  });

  it('acha o localizador dentro de "Localizador: R4YB7P"', async () => {
    const { service, prisma } = make({
      wonCards: [card({ metadata: { orderNumber: 'Localizador: R4YB7P' } })],
    });
    await service.correlateWonCards(NOW);

    const where = prisma.ofpSalesOrder.findFirst.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ pedido: { equals: 'R4YB7P', mode: 'insensitive' } });
    expect(prisma.card.update).toHaveBeenCalled();
  });

  it('idempotente: card já correlacionado não é tocado', async () => {
    const { service, prisma } = make({
      wonCards: [card({ metadata: { orderNumber: 'PED-1', ofpOrderExternalId: 'ext-9' } })],
    });
    const res = await service.correlateWonCards(NOW);

    expect(prisma.ofpSalesOrder.findFirst).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(res.matched).toBe(0);
  });

  it('nº não casa e card sem valor → casa pelo contato quando sobra 1 pedido', async () => {
    const { service, prisma } = make({
      wonCards: [card({ metadata: { orderNumber: 'Fechou guiamento' } })],
      order: null,
      contactOrders: [{ external_id: 'ext-guia', venda: 590 }],
    });
    const res = await service.correlateWonCards(NOW);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const upd = prisma.card.update.mock.calls[0][0];
    expect(upd.data.metadata).toMatchObject({ ofpOrderExternalId: 'ext-guia', correlatedBy: 'contact' });
    expect(upd.data.value).toBe(590);
    expect(res).toEqual({ matched: 1, checked: 1 });
  });

  it('Ganho sem nº nenhum também tenta pelo contato', async () => {
    const { service, prisma } = make({
      wonCards: [card()],
      contactOrders: [{ external_id: 'ext-1', venda: 1000 }],
    });
    await service.correlateWonCards(NOW);

    expect(prisma.ofpSalesOrder.findFirst).not.toHaveBeenCalled();
    expect(prisma.card.update).toHaveBeenCalled();
  });

  it('pelo contato: 2+ pedidos possíveis → ambíguo, não chuta', async () => {
    const { service, prisma } = make({
      wonCards: [card()],
      contactOrders: [
        { external_id: 'a', venda: 1 },
        { external_id: 'b', venda: 2 },
      ],
    });
    const res = await service.correlateWonCards(NOW);

    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(res).toEqual({ matched: 0, checked: 1 });
  });

  it('card que já tem valor não tenta pelo contato', async () => {
    const { service, prisma } = make({
      wonCards: [card({ value: 5000, metadata: { orderNumber: 'PED-X' } })],
      order: null,
    });
    await service.correlateWonCards(NOW);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.card.update).not.toHaveBeenCalled();
  });

  it('Ganho antigo (fora da janela) sem nº é ignorado', async () => {
    const { service, prisma } = make({
      wonCards: [card({ closedAt: new Date('2026-08-01T12:00:00Z') })],
    });
    const res = await service.correlateWonCards(NOW);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(res).toEqual({ matched: 0, checked: 0 });
  });

  it('contato sem telefone nem e-mail e sem nº → ignorado', async () => {
    const { service, prisma } = make({
      wonCards: [card({ contact: { phone: null, email: null } })],
    });
    const res = await service.correlateWonCards(NOW);

    expect(prisma.ofpSalesOrder.findFirst).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(res).toEqual({ matched: 0, checked: 0 });
  });
});
