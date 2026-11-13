import { MessagesService } from './messages.service';

function build(isSimulated: boolean) {
  const message = {
    id: 'msg1',
    direction: 'OUTBOUND',
    externalId: 'sim.out.abc',
    revokedAt: null,
    conversation: { id: 'conv1', organizationId: 'org1', channelId: 'chan1' },
  };
  const prisma: any = {
    message: { findUnique: jest.fn().mockResolvedValue(message), update: jest.fn().mockResolvedValue({}) },
    channel: { findUnique: jest.fn().mockResolvedValue({ id: 'chan1', type: 'WHATSAPP_ZAPPFY' }) },
  };
  const adapter = { deleteMessage: jest.fn().mockResolvedValue(undefined) };
  const adapterRegistry = { getOutbound: jest.fn().mockReturnValue(adapter) };
  const realtimeGateway = { emitToConversation: jest.fn(), emitToChannel: jest.fn() };
  const simulated = { isSimulatedConversation: jest.fn().mockResolvedValue(isSimulated) };
  const svc: MessagesService = Object.create(MessagesService.prototype);
  Object.assign(svc, {
    prisma,
    adapterRegistry,
    realtimeGateway,
    simulated,
    conversationAccess: { assertConversationAccess: jest.fn() },
    channelAccess: { assertChannelAccess: jest.fn() },
    logger: { log: jest.fn(), warn: jest.fn() },
  });
  return { svc, prisma, adapter };
}

describe('MessagesService.revokeForEveryone — contato simulado', () => {
  it('não chama o gateway, mas revoga localmente', async () => {
    const { svc, prisma, adapter } = build(true);

    const r = await svc.revokeForEveryone('msg1', 'org1', 'u1', 'ALL');

    expect(adapter.deleteMessage).not.toHaveBeenCalled();
    expect(prisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revokedBy: 'u1' }) }),
    );
    expect(r.succeededRemote).toBe(false);
  });

  it('contato normal: segue chamando o gateway', async () => {
    const { svc, adapter } = build(false);

    await svc.revokeForEveryone('msg1', 'org1', 'u1', 'ALL');

    expect(adapter.deleteMessage).toHaveBeenCalledTimes(1);
  });
});
