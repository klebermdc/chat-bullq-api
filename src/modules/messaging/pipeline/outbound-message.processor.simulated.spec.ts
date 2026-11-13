import { OutboundMessageProcessor } from './outbound-message.processor';

/**
 * INVARIANTE CRÍTICA: contato simulado (cliente oculto sem chip) NUNCA chega
 * ao adaptador real (Meta); contato normal não é afetado.
 */
describe('OutboundMessageProcessor — desvio para contato simulado', () => {
  function build(isSimulated: boolean) {
    const prisma = {
      channel: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'ch1', type: 'WHATSAPP_OFFICIAL' }) },
      message: {
        findUnique: jest.fn().mockResolvedValue({ metadata: {}, conversationId: 'c1' }),
        update: jest.fn().mockResolvedValue({ id: 'm1', conversationId: 'c1', metadata: {} }),
      },
    };
    const realAdapter = {
      sendMessage: jest.fn().mockResolvedValue({ externalId: 'wamid.real', providerResponse: {} }),
      sendTypingIndicator: jest.fn().mockResolvedValue(undefined),
    };
    const simulatedAdapter = {
      sendMessage: jest.fn().mockResolvedValue({ externalId: 'sim.out.abc', providerResponse: { simulated: true } }),
      sendTypingIndicator: jest.fn().mockResolvedValue(undefined),
    };
    const adapterRegistry = { getOutbound: jest.fn().mockReturnValue(realAdapter) };
    const simulated = { isSimulated: jest.fn().mockResolvedValue(isSimulated) };
    const processor = new OutboundMessageProcessor(
      prisma as any,
      adapterRegistry as any,
      { emitToChannel: jest.fn(), emitToConversation: jest.fn() } as any,
      { markProcessed: jest.fn().mockResolvedValue(undefined) } as any,
      { blockIfClosed: jest.fn().mockResolvedValue(false) } as any,
      { maybeStartForNoReply: jest.fn() } as any,
      simulated as any,
      simulatedAdapter as any,
    );
    return { processor, prisma, realAdapter, simulatedAdapter, adapterRegistry, simulated };
  }

  const job: any = {
    data: { messageId: 'm1', channelId: 'ch1', contactExternalId: '5511912345678', message: { type: 'TEXT', content: {} } },
    opts: { attempts: 1 },
    attemptsMade: 0,
  };

  it('contato normal usa o adaptador do registro e não o simulado', async () => {
    const t = build(false);
    await t.processor.process(job);
    expect(t.simulated.isSimulated).toHaveBeenCalledWith('ch1', '5511912345678');
    expect(t.realAdapter.sendMessage).toHaveBeenCalledTimes(1);
    expect(t.simulatedAdapter.sendMessage).not.toHaveBeenCalled();
  });

  it('contato simulado usa o simulado e NUNCA o do registro', async () => {
    const t = build(true);
    await t.processor.process(job);
    expect(t.simulatedAdapter.sendMessage).toHaveBeenCalledTimes(1);
    expect(t.realAdapter.sendMessage).not.toHaveBeenCalled();
    expect(t.realAdapter.sendTypingIndicator).not.toHaveBeenCalled();
    expect(t.prisma.message.update.mock.calls[0][0].data.externalId).toBe('sim.out.abc');
  });

  it('se a detecção falhar, o envio falha (não cai no adaptador real)', async () => {
    const t = build(true);
    t.simulated.isSimulated.mockRejectedValue(new Error('db down'));
    await expect(t.processor.process(job)).rejects.toThrow('db down');
    expect(t.realAdapter.sendMessage).not.toHaveBeenCalled();
  });
});
