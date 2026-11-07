import { ChannelType, ConversationStatus } from '@prisma/client';
import { InboundMessageProcessor } from './inbound-message.processor';

/**
 * SLA de resposta: mensagem nova do cliente abre a espera (o serviço decide
 * se a org ligou o recurso). Re-entrega do webhook e grupo não abrem; com a
 * IA no comando o relógio não começa.
 */
function build(opts: { existingMessage?: boolean } = {}) {
  const decision = { skipLegacyRouting: false, skipChatbot: true, skipAi: false };
  const prisma = {
    $transaction: jest.fn().mockImplementation((fn: any) =>
      fn({
        message: {
          findUnique: jest.fn().mockResolvedValue(
            opts.existingMessage ? { id: 'msg-1', status: 'DELIVERED', sentAt: null, deliveredAt: new Date() } : null,
          ),
          create: jest.fn().mockResolvedValue({ id: 'msg-1', type: 'INTERACTIVE' }),
        },
        conversation: { update: jest.fn().mockResolvedValue({}) },
      }),
    ),
    conversation: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'conv-1',
        channelId: 'ch-1',
        assignedToId: null,
        contact: { name: 'Maria', phone: '5511' },
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    chatbotFlowChannel: { findFirst: jest.fn().mockResolvedValue({ id: 'link-bot' }) },
    message: { findUnique: jest.fn().mockResolvedValue({ id: 'msg-1', type: 'INTERACTIVE' }) },
  } as any;
  const legacy = { routeNewConversation: jest.fn().mockResolvedValue({ routed: false }) };
  const responseSla = {
    onCustomerWaiting: jest.fn().mockResolvedValue(undefined),
    onHumanReply: jest.fn().mockResolvedValue(undefined),
  };
  const chatbotQueue = { add: jest.fn().mockResolvedValue({}) };
  const agentRouter = { shouldHandle: jest.fn().mockResolvedValue({ handle: false, reason: 'teste' }) };
  const websiteLeadInbound = { evaluate: jest.fn().mockResolvedValue(decision) };
  const resolvedConversation = {
    conversationId: 'conv-1',
    status: ConversationStatus.OPEN,
    isNew: false,
    wasReopened: false,
  };
  const ok = () => jest.fn().mockResolvedValue(undefined);
  const proc = new InboundMessageProcessor(
    prisma,
    { claimProcessing: jest.fn().mockResolvedValue(true), releaseClaim: ok() } as any,
    { resolve: jest.fn().mockResolvedValue({ contactId: 'contact-1', isNew: false }) } as any,
    { resolve: jest.fn().mockResolvedValue(resolvedConversation) } as any,
    { emitToChannel: jest.fn(), emitToConversation: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    { markProcessed: ok(), markFailed: ok() } as any,
    agentRouter as any,
    { run: ok() } as any,
    {} as any,
    { enqueue: ok() } as any,
    { scheduleCheck: ok(), cancelCheck: ok() } as any,
    { onInboundReply: ok() } as any,
    { onInboundReply: ok() } as any,
    { cancelPendingForConversation: ok(), cancelPendingForConversationIfCancelOnReply: ok() } as any,
    { handleInbound: ok() } as any,
    chatbotQueue as any,
    { observe: ok() } as any,
    {
      tagInstagramOrganicIfMatch: jest.fn().mockResolvedValue(false),
      tagAdLeadIfReferral: jest.fn().mockResolvedValue(false),
      tagAdLeadIfMarkerPhrase: jest.fn().mockResolvedValue(false),
    } as any,
    { ensureLeadCard: jest.fn().mockResolvedValue(null) } as any,
    { add: jest.fn().mockResolvedValue({}) } as any,
    { recordWindow: ok() } as any,
    { onInboundMessage: ok() } as any,
    { onInboundReply: ok() } as any,
    legacy as any,
    websiteLeadInbound as any,
    responseSla as any,
  );
  return { proc, prisma, agentRouter, responseSla };
}

const JOB = {
  name: 'process-inbound',
  data: {
    channelId: 'ch-1',
    organizationId: 'org-1',
    message: {
      externalMessageId: 'wamid.1',
      externalContactId: '5511988887777',
      channelType: ChannelType.WHATSAPP_OFFICIAL,
      type: 'INTERACTIVE',
      content: { text: 'Sim, pode perguntar', interactive: { type: 'button' } },
      timestamp: new Date(),
    },
  },
} as any;

const job = (patch: Record<string, unknown> = {}) =>
  ({
    name: 'process-inbound',
    data: {
      channelId: 'ch-1',
      organizationId: 'org-1',
      message: {
        externalMessageId: 'wamid.1',
        externalContactId: '5511988887777',
        channelType: ChannelType.WHATSAPP_OFFICIAL,
        type: 'TEXT',
        content: { text: 'Oi, tem pacote pra Orlando?' },
        timestamp: new Date(),
        ...patch,
      },
    },
  }) as any;

const flush = () => new Promise((r) => setImmediate(r));

describe('InboundMessageProcessor — SLA de resposta', () => {
  it('mensagem nova do cliente abre a espera', async () => {
    const { proc, responseSla } = build();

    await proc.process(job());
    await flush();

    expect(responseSla.onCustomerWaiting).toHaveBeenCalledWith(
      'conv-1',
      expect.any(Date),
      expect.any(Function),
    );
  });

  it('IA no comando: o predicado diz para não abrir', async () => {
    const { proc, responseSla, agentRouter, prisma } = build();
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv-1', aiUntilHandoff: false });
    agentRouter.shouldHandle.mockResolvedValue({ handle: true });

    await proc.process(job());
    await flush();
    const isAiInCharge = responseSla.onCustomerWaiting.mock.calls[0][2];

    await expect(isAiInCharge()).resolves.toBe(true);
  });

  it('humano no comando: o predicado libera', async () => {
    const { proc, responseSla, agentRouter, prisma } = build();
    prisma.conversation.findUnique.mockResolvedValue({ id: 'conv-1', aiUntilHandoff: false });
    agentRouter.shouldHandle.mockResolvedValue({ handle: false, reason: 'assigned-to-human' });

    await proc.process(job());
    await flush();
    const isAiInCharge = responseSla.onCustomerWaiting.mock.calls[0][2];

    await expect(isAiInCharge()).resolves.toBe(false);
  });

  it('re-entrega do webhook (mensagem já gravada) não abre espera', async () => {
    const { proc, responseSla } = build({ existingMessage: true });

    await proc.process(job());
    await flush();

    expect(responseSla.onCustomerWaiting).not.toHaveBeenCalled();
  });

  it('mensagem de grupo não abre espera', async () => {
    const { proc, responseSla } = build();

    await proc.process(job({ isGroup: true }));
    await flush();

    expect(responseSla.onCustomerWaiting).not.toHaveBeenCalled();
  });

  it('echo humano (coexistência) fecha a espera', async () => {
    const { proc, responseSla } = build();

    await proc.process(job({ isEcho: true, isHumanEcho: true }));
    await flush();

    expect(responseSla.onHumanReply).toHaveBeenCalledWith('conv-1', expect.any(Date));
    expect(responseSla.onCustomerWaiting).not.toHaveBeenCalled();
  });
});
