import { ChannelType, ConversationStatus } from '@prisma/client';
import { InboundMessageProcessor } from './inbound-message.processor';

/**
 * Resposta do cliente ao template de retorno do lead do site: a conversa
 * está com a Aline até o handoff. O pipeline de entrada NÃO pode mandar para
 * a carteira (que desliga a IA) nem disparar o chatbot de boas-vindas.
 */
function build(decision: { skipLegacyRouting: boolean; skipChatbot: boolean; skipAi: boolean }, opts: {
  conversationIsNew?: boolean;
} = {}) {
  const prisma = {
    $transaction: jest.fn().mockImplementation((fn: any) =>
      fn({
        message: {
          findUnique: jest.fn().mockResolvedValue(null),
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
  const legacy = { routeNewConversation: jest.fn().mockResolvedValue({ routed: true }) };
  const chatbotQueue = { add: jest.fn().mockResolvedValue({}) };
  const agentRouter = { shouldHandle: jest.fn().mockResolvedValue({ handle: false, reason: 'teste' }) };
  const websiteLeadInbound = { evaluate: jest.fn().mockResolvedValue(decision) };
  const resolvedConversation = {
    conversationId: 'conv-1',
    status: opts.conversationIsNew ? ConversationStatus.PENDING : ConversationStatus.OPEN,
    isNew: !!opts.conversationIsNew,
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
  );
  return { proc, legacy, chatbotQueue, agentRouter, websiteLeadInbound, resolvedConversation };
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

describe('InboundMessageProcessor — resposta ao template do lead do site', () => {
  afterEach(() => jest.useRealTimers());

  it('com a Aline até o handoff: nem carteira nem chatbot, e a IA é chamada', async () => {
    const { proc, legacy, chatbotQueue, agentRouter, websiteLeadInbound } = build(
      { skipLegacyRouting: true, skipChatbot: true, skipAi: false },
      { conversationIsNew: true },
    );

    await proc.process(JOB);
    await new Promise((r) => setImmediate(r));

    expect(websiteLeadInbound.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Sim, pode perguntar', conversationIsNewOrReopened: true }),
    );
    expect(legacy.routeNewConversation).not.toHaveBeenCalled();
    expect(chatbotQueue.add).not.toHaveBeenCalled();
    expect(agentRouter.shouldHandle).toHaveBeenCalled();
  });

  it('"Agora não" já respondido: a IA nem é consultada', async () => {
    const { proc } = build({ skipLegacyRouting: true, skipChatbot: true, skipAi: true });
    const tryAi = jest.spyOn(proc as any, 'tryAiAgent');
    await proc.process(JOB);
    await new Promise((r) => setImmediate(r));
    expect(tryAi).not.toHaveBeenCalled();
  });

  it('conversa comum continua indo para a carteira e para o chatbot', async () => {
    const { proc, legacy, chatbotQueue } = build(
      { skipLegacyRouting: false, skipChatbot: false, skipAi: false },
      { conversationIsNew: true },
    );
    legacy.routeNewConversation.mockResolvedValue({ routed: false, reason: 'not_found' });

    await proc.process(JOB);

    expect(legacy.routeNewConversation).toHaveBeenCalled();
    expect(chatbotQueue.add).toHaveBeenCalledWith('process-bot', expect.anything(), expect.anything());
  });
});
