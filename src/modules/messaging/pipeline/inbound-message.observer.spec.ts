import { InboundMessageProcessor } from './inbound-message.processor';

/**
 * Task 12: a observação SHADOW acontece no pipeline inbound de forma
 * fire-and-forget e ANTES do gate de resposta da IA. Ou seja: mesmo quando
 * `shouldHandle` decide que a IA NÃO responde, o observer ainda é chamado
 * (aprendemos com a conversa humana independentemente da resposta).
 */
describe('InboundMessageProcessor — observação SHADOW independe do gate', () => {
  function buildProcessor(overrides: {
    prisma: any;
    agentRouter: any;
    agentRunner: any;
    shadowObserver: any;
  }): InboundMessageProcessor {
    // Ordem posicional EXATA do construtor de InboundMessageProcessor:
    //  1 prisma, 2 idempotency, 3 contactResolver, 4 conversationResolver,
    //  5 realtimeGateway, 6 instagramEnricher, 7 zappfyEnricher,
    //  8 webhookEvents, 9 agentRouter, 10 agentRunner, 11 transcription,
    //  12 outbox, 13 watchdog, 14 salesRecovery, 15 scheduled,
    //  16 chatbotQueue, 17 shadowObserver.
    return new InboundMessageProcessor(
      overrides.prisma, // 1 prisma
      {} as any, // 2 idempotency
      {} as any, // 3 contactResolver
      {} as any, // 4 conversationResolver
      {} as any, // 5 realtimeGateway
      {} as any, // 6 instagramEnricher
      {} as any, // 7 zappfyEnricher
      {} as any, // 8 webhookEvents
      overrides.agentRouter, // 9 agentRouter
      overrides.agentRunner, // 10 agentRunner
      {} as any, // 11 transcription
      {} as any, // 12 outbox
      {} as any, // 13 watchdog
      {} as any, // 14 salesRecovery
      {} as any, // 15 scheduled
      {} as any, // 16 chatbotQueue
      overrides.shadowObserver, // 17 shadowObserver
    );
  }

  it('chama shadowObserver.observe mesmo quando a IA não responde', async () => {
    const prisma = {
      conversation: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'c1', channelId: 'ch1', organizationId: 'org1' }),
      },
      message: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any;
    const agentRouter = {
      shouldHandle: jest
        .fn()
        .mockResolvedValue({ handle: false, reason: 'ai_disabled' }),
    } as any;
    const agentRunner = { run: jest.fn() } as any;
    const shadowObserver = {
      observe: jest.fn().mockResolvedValue(undefined),
    } as any;

    const proc = buildProcessor({ prisma, agentRouter, agentRunner, shadowObserver });

    await (proc as any).fireAgentRun('c1');

    // (a) observação sempre acontece — antes do gate.
    expect(shadowObserver.observe).toHaveBeenCalledWith('c1');
    // (b) IA não respondeu porque o gate barrou.
    expect(agentRunner.run).not.toHaveBeenCalled();
  });

  it('observa e também roda o agente quando a IA responde', async () => {
    const conv = { id: 'c1', channelId: 'ch1', organizationId: 'org1' };
    const latestInbound = { id: 'm1', direction: 'INBOUND', type: 'TEXT' };
    const prisma = {
      conversation: { findUnique: jest.fn().mockResolvedValue(conv) },
      message: { findFirst: jest.fn().mockResolvedValue(latestInbound) },
    } as any;
    const agentRouter = {
      shouldHandle: jest.fn().mockResolvedValue({ handle: true }),
    } as any;
    const agentRunner = { run: jest.fn().mockResolvedValue(undefined) } as any;
    const shadowObserver = {
      observe: jest.fn().mockResolvedValue(undefined),
    } as any;

    const proc = buildProcessor({ prisma, agentRouter, agentRunner, shadowObserver });

    await (proc as any).fireAgentRun('c1');

    expect(shadowObserver.observe).toHaveBeenCalledWith('c1');
    expect(agentRunner.run).toHaveBeenCalledTimes(1);
  });
});
