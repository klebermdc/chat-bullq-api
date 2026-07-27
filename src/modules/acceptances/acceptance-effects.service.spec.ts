import { AcceptanceEffectsService } from './acceptance-effects.service';

describe('AcceptanceEffectsService.onSigned', () => {
  it('posta SYSTEM msg no thread, seta selo no card (merge) e emite realtime', async () => {
    const sysMsg = { id: 'sys-1' };
    const prisma = {
      conversation: { findUnique: jest.fn().mockResolvedValue({ id: 'conv-1', channelId: 'ch-1', contactId: 'ct-1' }) },
      message: { create: jest.fn().mockResolvedValue(sysMsg) },
      card: {
        findUnique: jest.fn().mockResolvedValue({ id: 'card-1', metadata: { orderNumber: '123' } }),
        update: jest.fn().mockResolvedValue({ id: 'card-1', metadata: { orderNumber: '123', acceptance: { status: 'SIGNED' } } }),
      },
    } as any;
    const realtime = { emitToChannel: jest.fn(), emitToConversation: jest.fn(), emitToOrg: jest.fn() } as any;
    const svc = new AcceptanceEffectsService(prisma, realtime);

    await svc.onSigned({
      id: 'acc-1', organizationId: 'org-1', conversationId: 'conv-1', cardId: 'card-1',
      signerName: 'João', signedAt: new Date('2026-07-26T14:00:00Z'),
    } as any);

    expect(prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ conversationId: 'conv-1', type: 'SYSTEM' }),
    }));
    // merge: existing orderNumber preserved, acceptance added
    const updateArg = prisma.card.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'card-1' });
    expect(updateArg.data.metadata).toEqual(expect.objectContaining({ orderNumber: '123' }));
    expect(updateArg.data.metadata.acceptance).toEqual(expect.objectContaining({ status: 'SIGNED' }));
    expect(realtime.emitToConversation).toHaveBeenCalledWith('conv-1', 'message:new', { message: sysMsg });
    expect(realtime.emitToOrg).toHaveBeenCalledWith('org-1', 'card:updated', expect.any(Object));
  });

  it('sem card não quebra (só posta a SYSTEM msg)', async () => {
    const prisma = {
      conversation: { findUnique: jest.fn().mockResolvedValue({ id: 'conv-1', channelId: 'ch-1', contactId: 'ct-1' }) },
      message: { create: jest.fn().mockResolvedValue({ id: 'sys-1' }) },
      card: { findUnique: jest.fn(), update: jest.fn() },
    } as any;
    const realtime = { emitToChannel: jest.fn(), emitToConversation: jest.fn(), emitToOrg: jest.fn() } as any;
    const svc = new AcceptanceEffectsService(prisma, realtime);
    await svc.onSigned({ id: 'a', organizationId: 'org-1', conversationId: 'conv-1', cardId: null,
      signerName: 'João', signedAt: new Date() } as any);
    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(prisma.message.create).toHaveBeenCalled();
  });
});
