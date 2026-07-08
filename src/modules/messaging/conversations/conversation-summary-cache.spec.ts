import { ConversationsService } from './conversations.service';

function makeService(overrides: {
  conversation: any;
  messageCount: number;
  messages?: any[];
  summarizeResult?: any;
}) {
  const prisma = {
    message: {
      count: jest.fn().mockResolvedValue(overrides.messageCount),
      findMany: jest.fn().mockResolvedValue(overrides.messages ?? []),
    },
    conversation: { update: jest.fn().mockResolvedValue({}) },
  } as any;
  const summarizer = {
    summarize: jest.fn().mockResolvedValue(
      overrides.summarizeResult ?? {
        summary: 'resumo novo',
        sentiment: 'neutro',
        objection: null,
        replies: [],
      },
    ),
  } as any;

  const svc = new ConversationsService(
    {} as any, // repository
    {} as any, // fsm
    {} as any, // realtimeGateway
    prisma,
    {} as any, // adapterRegistry
    {} as any, // historyImporter
    {} as any, // channelAccess
    {} as any, // agentRouter
    {} as any, // agentRunner
    {} as any, // segmentRead
    {} as any, // projects
    {} as any, // scheduled (ScheduledMessagesService)
    summarizer,
  );
  jest.spyOn(svc, 'findOne').mockResolvedValue(overrides.conversation);
  return { svc, prisma, summarizer };
}

const AT = new Date('2026-07-07T10:00:00.000Z');

describe('ConversationsService.getAiSummary', () => {
  it('retorna tooShort sem chamar o LLM quando há menos de 2 mensagens', async () => {
    const { svc, summarizer } = makeService({
      conversation: { id: 'c1', lastMessageAt: AT },
      messageCount: 1,
    });
    const res = await svc.getAiSummary('c1', 'org1', 'ALL', 'u1', 'OWNER' as any, {});
    expect(res).toEqual({
      summary: null,
      sentiment: null,
      generatedAt: null,
      cached: false,
      tooShort: true,
      objection: null,
      replies: [],
    });
    expect(summarizer.summarize).not.toHaveBeenCalled();
  });

  it('devolve o cache quando aiSummaryUpToAt == lastMessageAt', async () => {
    const { svc, summarizer } = makeService({
      conversation: {
        id: 'c1',
        lastMessageAt: AT,
        aiSummary: 'resumo salvo',
        aiSummarySentiment: 'satisfeito',
        aiSummaryAt: AT,
        aiSummaryUpToAt: AT,
        aiReplies: null,
      },
      messageCount: 5,
    });
    const res = await svc.getAiSummary('c1', 'org1', 'ALL', 'u1', 'OWNER' as any, {});
    expect(res).toEqual({
      summary: 'resumo salvo',
      sentiment: 'satisfeito',
      generatedAt: AT.toISOString(),
      cached: true,
      objection: null,
      replies: [],
    });
    expect(summarizer.summarize).not.toHaveBeenCalled();
  });

  it('devolve objeção/respostas persistidas no cache-hit', async () => {
    const { svc, summarizer } = makeService({
      conversation: {
        id: 'c1',
        lastMessageAt: AT,
        aiSummary: 'resumo salvo',
        aiSummarySentiment: 'satisfeito',
        aiSummaryAt: AT,
        aiSummaryUpToAt: AT,
        aiReplies: { objecao: 'achou caro', respostas: ['a', 'b', 'c'] },
      },
      messageCount: 5,
    });
    const res = await svc.getAiSummary('c1', 'org1', 'ALL', 'u1', 'OWNER' as any, {});
    expect(res.objection).toBe('achou caro');
    expect(res.replies).toEqual(['a', 'b', 'c']);
    expect(summarizer.summarize).not.toHaveBeenCalled();
  });

  it('regenera quando chegou mensagem nova (lastMessageAt mudou)', async () => {
    const NEW = new Date('2026-07-07T11:00:00.000Z');
    const { svc, prisma, summarizer } = makeService({
      conversation: {
        id: 'c1',
        lastMessageAt: NEW,
        aiSummary: 'resumo velho',
        aiSummarySentiment: 'neutro',
        aiSummaryAt: AT,
        aiSummaryUpToAt: AT,
      },
      messageCount: 6,
      messages: [
        { direction: 'INBOUND', type: 'TEXT', content: { text: 'oi' } },
        { direction: 'OUTBOUND', type: 'TEXT', content: { text: 'olá' } },
      ],
      summarizeResult: {
        summary: 'resumo fresco',
        sentiment: 'irritado',
        objection: 'achou caro',
        replies: ['a', 'b', 'c'],
      },
    });
    const res = await svc.getAiSummary('c1', 'org1', 'ALL', 'u1', 'OWNER' as any, {});
    expect(summarizer.summarize).toHaveBeenCalledWith('org1', [
      { direction: 'INBOUND', text: 'oi' },
      { direction: 'OUTBOUND', text: 'olá' },
    ]);
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        aiSummary: 'resumo fresco',
        aiSummarySentiment: 'irritado',
        aiSummaryAt: expect.any(Date),
        aiSummaryUpToAt: NEW,
        aiReplies: { objecao: 'achou caro', respostas: ['a', 'b', 'c'] },
      },
    });
    expect(res.summary).toBe('resumo fresco');
    expect(res.cached).toBe(false);
    expect(res.objection).toBe('achou caro');
    expect(res.replies).toEqual(['a', 'b', 'c']);
    expect(prisma.message.count).toHaveBeenCalledWith({ where: { conversationId: 'c1' } });
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: 'c1' },
        orderBy: { createdAt: 'asc' },
        take: 40,
        skip: 0, // max(6 - 40, 0)
      }),
    );
  });

  it('refresh=true força regenerar mesmo com cache fresco', async () => {
    const { svc, summarizer } = makeService({
      conversation: {
        id: 'c1',
        lastMessageAt: AT,
        aiSummary: 'resumo salvo',
        aiSummarySentiment: 'satisfeito',
        aiSummaryAt: AT,
        aiSummaryUpToAt: AT,
      },
      messageCount: 5,
      messages: [
        { direction: 'INBOUND', type: 'TEXT', content: { text: 'a' } },
        { direction: 'INBOUND', type: 'TEXT', content: { text: 'b' } },
      ],
    });
    await svc.getAiSummary('c1', 'org1', 'ALL', 'u1', 'OWNER' as any, { refresh: true });
    expect(summarizer.summarize).toHaveBeenCalled();
  });

  it('retorna tooShort quando as mensagens não têm texto suficiente', async () => {
    const { svc, summarizer } = makeService({
      conversation: { id: 'c1', lastMessageAt: AT },
      messageCount: 3,
      messages: [
        { direction: 'INBOUND', type: 'AUDIO', content: {} },
        { direction: 'INBOUND', type: 'IMAGE', content: {} },
      ],
    });
    const res = await svc.getAiSummary('c1', 'org1', 'ALL', 'u1', 'OWNER' as any, {});
    expect(res.tooShort).toBe(true);
    expect(summarizer.summarize).not.toHaveBeenCalled();
  });

  it('mantém o resumo antigo quando o cache está velho mas não há texto novo suficiente', async () => {
    const NEW = new Date('2026-07-07T11:00:00.000Z');
    const { svc, summarizer } = makeService({
      conversation: {
        id: 'c1',
        lastMessageAt: NEW,
        aiSummary: 'resumo antigo',
        aiSummarySentiment: 'satisfeito',
        aiSummaryAt: AT,
        aiSummaryUpToAt: AT,
        aiReplies: null,
      },
      messageCount: 3,
      messages: [
        { direction: 'INBOUND', type: 'AUDIO', content: {} },
        { direction: 'INBOUND', type: 'IMAGE', content: {} },
      ],
    });
    const res = await svc.getAiSummary('c1', 'org1', 'ALL', 'u1', 'OWNER' as any, {});
    expect(res).toEqual({
      summary: 'resumo antigo',
      sentiment: 'satisfeito',
      generatedAt: AT.toISOString(),
      cached: true,
      objection: null,
      replies: [],
    });
    expect(summarizer.summarize).not.toHaveBeenCalled();
  });
});
