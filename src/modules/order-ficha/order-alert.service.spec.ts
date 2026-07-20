import { OrderAlertService } from './order-alert.service';

describe('OrderAlertService.raise', () => {
  let prisma: any;
  let realtime: any;
  let svc: OrderAlertService;
  beforeEach(() => {
    prisma = {
      message: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'sys1' }) },
      conversation: { update: jest.fn().mockResolvedValue({}) },
    };
    realtime = { emitToConversation: jest.fn(), emitToChannel: jest.fn() };
    svc = new OrderAlertService(prisma, realtime);
  });

  it('não posta nada quando não há divergência', async () => {
    await svc.raise('cv1', 'ch1', []);
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('posta SYSTEM e marca a conversa quando há divergência', async () => {
    await svc.raise('cv1', 'ch1', [{ kind: 'ITEM_MISMATCH', message: 'x', detail: {}, detectedAt: '2026-07-20T00:00:00Z' }]);
    expect(prisma.message.create).toHaveBeenCalled();
    expect(prisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'cv1' }, data: { hasOrderDivergence: true } }));
  });

  it('deduplica: não reposta SYSTEM idêntico ao último', async () => {
    const div = [{ kind: 'ITEM_MISMATCH' as const, message: 'x', detail: {}, detectedAt: '2026-07-20T00:00:00Z' }];
    prisma.message.findFirst.mockResolvedValue({ content: { text: '⚠️ Divergência no pedido:\n• x', orderDivergence: true } });
    await svc.raise('cv1', 'ch1', div);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('setDivergenceFlag(false) limpa o selo da conversa', async () => {
    await svc.setDivergenceFlag('cv1', false);
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'cv1' },
      data: { hasOrderDivergence: false },
    });
  });

  it('setDivergenceFlag(true) liga o selo da conversa', async () => {
    await svc.setDivergenceFlag('cv1', true);
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'cv1' },
      data: { hasOrderDivergence: true },
    });
  });
});
