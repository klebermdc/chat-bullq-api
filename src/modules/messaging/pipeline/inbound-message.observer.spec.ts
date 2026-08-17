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
    //  8 messengerEnricher, 9 webhookEvents, 10 agentRouter, 11 agentRunner,
    //  12 transcription, 13 outbox, 14 watchdog, 15 salesRecovery,
    //  16 agentAvailability, 17 scheduled, 18 cadenceInbound, 19 chatbotQueue,
    //  20 shadowObserver, 21 leadSourceTagger, 22 leadCard, 23 orderFichaQueue,
    //  24 channelUsage, 25 inboundNotifier, 26 orgOffHours.
    return new InboundMessageProcessor(
      overrides.prisma, // 1 prisma
      {} as any, // 2 idempotency
      {} as any, // 3 contactResolver
      {} as any, // 4 conversationResolver
      {} as any, // 5 realtimeGateway
      {} as any, // 6 instagramEnricher
      {} as any, // 7 zappfyEnricher
      {} as any, // 8 messengerEnricher
      {} as any, // 9 webhookEvents
      overrides.agentRouter, // 10 agentRouter
      overrides.agentRunner, // 11 agentRunner
      {} as any, // 12 transcription
      {} as any, // 13 outbox
      // 14 watchdog — fireAgentRun chama watchdog.cancelCheck().catch() após
      // um run bem-sucedido; stub que resolve pra não gerar ERROR no log.
      { cancelCheck: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any, // 15 salesRecovery
      { onInboundReply: jest.fn().mockResolvedValue(undefined) } as any, // 16 agentAvailability
      {} as any, // 17 scheduled
      {} as any, // 18 cadenceInbound
      {} as any, // 19 chatbotQueue
      overrides.shadowObserver, // 20 shadowObserver
      { tagInstagramOrganicIfMatch: jest.fn().mockResolvedValue(false) } as any, // 21 leadSourceTagger
      { ensureLeadCard: jest.fn().mockResolvedValue(null) } as any, // 22 leadCard
      { add: jest.fn().mockResolvedValue(undefined) } as any, // 23 orderFichaQueue
      { recordWindow: jest.fn().mockResolvedValue(undefined) } as any, // 24 channelUsage
      { onInboundMessage: jest.fn().mockResolvedValue(undefined) } as any, // 25 inboundNotifier
      { onInboundReply: jest.fn().mockResolvedValue(undefined) } as any, // 26 orgOffHours
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
