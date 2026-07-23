import { MessageStatus } from '@prisma/client';
import { OutboundMessageProcessor } from './outbound-message.processor';

/**
 * Foco: o gatilho de reengajamento de entrada (Task 9) — depois que uma
 * mensagem SAI com sucesso, se ela foi enviada pela Aline (agente IA,
 * metadata.aiAgentId presente), arma a cadência NO_REPLY via
 * `cadenceRunner.maybeStartForNoReply(conversationId)`. Toques de cadência
 * (humano/sistema) NÃO têm aiAgentId, então não re-disparam — sem loop.
 *
 * Também cobre a correção correlata: `metadata` é campo JSON no Prisma —
 * o update que marca SENT precisa preservar aiAgentId/runId já existentes
 * (lidos antes do update), não sobrescrever com só `providerResponse`.
 */
describe('OutboundMessageProcessor — gatilho de reengajamento NO_REPLY', () => {
  function buildProcessor(overrides?: {
    existingMetadata?: Record<string, any>;
    updatedRow?: Record<string, any>;
  }) {
    const existingMetadata = overrides?.existingMetadata ?? { aiAgentId: 'ag1', runId: 'run1' };
    const updatedRow = overrides?.updatedRow ?? {
      id: 'm1',
      conversationId: 'c1',
      metadata: existingMetadata,
    };

    const prisma = {
      channel: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'ch1', type: 'WHATSAPP_WASENDER' }),
      },
      message: {
        // Called twice: once by simulateTypingIfAiMessage, once by process()
        // right before the SENT update (to preserve existing metadata).
        findUnique: jest.fn().mockResolvedValue({
          metadata: existingMetadata,
          conversationId: 'c1',
        }),
        update: jest.fn().mockResolvedValue(updatedRow),
      },
    };

    const adapter = {
      sendMessage: jest.fn().mockResolvedValue({ externalId: 'ext1', providerResponse: {} }),
      sendTypingIndicator: jest.fn().mockResolvedValue(undefined),
    };
    const adapterRegistry = {
      getOutbound: jest.fn().mockReturnValue(adapter),
    };
    const realtimeGateway = {
      emitToChannel: jest.fn(),
      emitToConversation: jest.fn(),
    };
    const idempotency = {
      markProcessed: jest.fn().mockResolvedValue(undefined),
    };
    const cadenceRunner = {
      maybeStartForNoReply: jest.fn().mockResolvedValue(null),
    };

    const processor = new OutboundMessageProcessor(
      prisma as any,
      adapterRegistry as any,
      realtimeGateway as any,
      idempotency as any,
      cadenceRunner as any,
    );

    return { processor, prisma, adapter, adapterRegistry, realtimeGateway, idempotency, cadenceRunner };
  }

  function buildJob() {
    return {
      data: {
        messageId: 'm1',
        channelId: 'ch1',
        contactExternalId: 'contact-x',
        // Sem texto → simulateTypingIfAiMessage sai cedo (sem delay real no teste).
        message: { content: {} },
      },
      opts: { attempts: 1 },
      attemptsMade: 0,
    } as any;
  }

  it('mensagem da Aline (metadata.aiAgentId) arma a cadência NO_REPLY', async () => {
    const { processor, cadenceRunner } = buildProcessor();

    await processor.process(buildJob());

    expect(cadenceRunner.maybeStartForNoReply).toHaveBeenCalledWith('c1');
    expect(cadenceRunner.maybeStartForNoReply).toHaveBeenCalledTimes(1);
  });

  it('mensagem sem aiAgentId (humano/toque de cadência) NÃO arma a cadência', async () => {
    const { processor, cadenceRunner } = buildProcessor({
      existingMetadata: {},
      updatedRow: { id: 'm1', conversationId: 'c1', metadata: {} },
    });

    await processor.process(buildJob());

    expect(cadenceRunner.maybeStartForNoReply).not.toHaveBeenCalled();
  });

  it('preserva aiAgentId/runId existentes no update de status SENT (não sobrescreve metadata)', async () => {
    const { processor, prisma } = buildProcessor();

    await processor.process(buildJob());

    const updateCall = prisma.message.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe(MessageStatus.SENT);
    expect(updateCall.data.metadata).toEqual(
      expect.objectContaining({ aiAgentId: 'ag1', runId: 'run1' }),
    );
  });
});
