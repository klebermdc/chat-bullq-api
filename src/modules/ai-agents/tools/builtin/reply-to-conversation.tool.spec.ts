import { ReplyToConversationTool } from './reply-to-conversation.tool';

const CTX = {
  organizationId: 'org-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  channelId: 'ch-1',
  agentId: 'agent-aline',
  runId: 'run-1',
};

function make(aiSecurityRules: Record<string, unknown> | null = null) {
  const prisma = {
    aiAgent: { findUnique: jest.fn().mockResolvedValue({ name: 'Aline' }) },
    contactChannel: { findFirst: jest.fn().mockResolvedValue({ externalId: '5511999990000' }) },
    conversation: {
      findUnique: jest.fn().mockResolvedValue({
        organization: { allowedUrlDomains: ['orlandofastpass.com.br'], aiSecurityRules },
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    message: { create: jest.fn().mockResolvedValue({ id: 'msg-1' }) },
  } as any;
  const realtime = { emitToChannel: jest.fn(), emitToConversation: jest.fn() } as any;
  const queue = { add: jest.fn().mockResolvedValue({}) } as any;
  const sendChecks = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const factCheck = { scheduleAfterSend: jest.fn() } as any;
  return {
    tool: new ReplyToConversationTool(prisma, realtime, queue, sendChecks, factCheck),
    prisma,
    queue,
    sendChecks,
    factCheck,
  };
}

describe('ReplyToConversationTool — telefone de emergência', () => {
  it('bloqueia o número de emergência escrito pelo modelo', async () => {
    const { tool, queue } = make();

    const result = await tool.execute({ text: 'Liga no nosso plantão: 11 5194-1724' }, CTX);

    expect(result.output).toMatchObject({ ok: false, error: 'emergency_phone_blocked' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('deliver manda a mensagem montada pelo sistema, com link fora da lista de domínios', async () => {
    const { tool, prisma, queue } = make();

    const result = await tool.deliver('Toque aqui: https://wa.me/551151941724', CTX, { emergencyContact: true });

    expect(result).toEqual({ output: { ok: true, messageId: 'msg-1' }, finalAction: 'REPLIED' });
    expect(prisma.message.create.mock.calls[0][0].data.metadata).toEqual({
      emergencyContact: true,
      aiAgentId: 'agent-aline',
      runId: 'run-1',
    });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('resposta comum continua passando', async () => {
    const { tool, queue } = make();

    const result = await tool.execute({ text: 'O Pedro volta amanhã às 9h.' }, CTX);

    expect(result.output).toMatchObject({ ok: true });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});

describe('ReplyToConversationTool — sem assunto comercial (blockCommercialTalk)', () => {
  it('com a regra ligada, bloqueia preço e registra o bloqueio', async () => {
    const { tool, queue, sendChecks } = make({ blockCommercialTalk: true });

    const result = await tool.execute({ text: 'O ingresso custa R$ 699 em 10x sem juros' }, CTX);

    expect(result.output).toMatchObject({ ok: false, error: 'commercial_talk_blocked' });
    expect((result.output as { message: string }).message).toMatch(/transferToHuman/);
    expect(queue.add).not.toHaveBeenCalled();
    expect(sendChecks.record).toHaveBeenCalledWith(
      expect.objectContaining({ check: 'commercial', verdict: 'blocked', runId: 'run-1' }),
    );
  });

  it('com a regra desligada (padrão), o preço passa como hoje', async () => {
    const { tool, queue } = make();

    const result = await tool.execute({ text: 'O ingresso custa R$ 699' }, CTX);

    expect(result.output).toMatchObject({ ok: true });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('com a regra ligada, fala de viagem sem valor passa', async () => {
    const { tool, queue } = make({ blockCommercialTalk: true });

    const result = await tool.execute({ text: 'O parque abre às 9h e são 4 parques.' }, CTX);

    expect(result.output).toMatchObject({ ok: true });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});

describe('ReplyToConversationTool — promessa de humano sem ação', () => {
  const PROMESSA = 'Vou passar seu pedido pro nosso consultor e ele te retorna.';

  it('bloqueia a promessa quando ninguém foi acionado no run', async () => {
    const { tool, queue, sendChecks } = make();

    const result = await tool.execute(
      { text: PROMESSA },
      { ...CTX, outboundGuards: { priorToolCalls: [{ name: 'lookupOffering', ok: true }] } },
    );

    expect(result.output).toMatchObject({ ok: false, error: 'human_promise_without_action' });
    expect(queue.add).not.toHaveBeenCalled();
    expect(sendChecks.record).toHaveBeenCalledWith(
      expect.objectContaining({ check: 'human_promise', verdict: 'blocked' }),
    );
  });

  it.each(['transferToHuman', 'leaveNoteForSeller'])('deixa passar depois de %s', async (name) => {
    const { tool, queue } = make();

    const result = await tool.execute(
      { text: PROMESSA },
      { ...CTX, outboundGuards: { priorToolCalls: [{ name, ok: true }] } },
    );

    expect(result.output).toMatchObject({ ok: true });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('ação que falhou não conta como acionamento', async () => {
    const { tool } = make();

    const result = await tool.execute(
      { text: PROMESSA },
      { ...CTX, outboundGuards: { priorToolCalls: [{ name: 'leaveNoteForSeller', ok: false }] } },
    );

    expect(result.output).toMatchObject({ ok: false, error: 'human_promise_without_action' });
  });
});

describe('ReplyToConversationTool — conferência de fato (só observa)', () => {
  const GUARDS = {
    priorToolCalls: [{ name: 'lookupOffering', ok: true, output: { name: 'Ingresso' } }],
    promptEvidence: 'catálogo e instruções',
  };

  it('agenda a conferência depois do envio, sem bloquear', async () => {
    const { tool, factCheck, queue } = make();

    const result = await tool.execute({ text: 'O Epcot abre às 10h.' }, { ...CTX, outboundGuards: GUARDS });

    expect(result.output).toMatchObject({ ok: true });
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(factCheck.scheduleAfterSend).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'O Epcot abre às 10h.',
        promptEvidence: 'catálogo e instruções',
        priorToolCalls: GUARDS.priorToolCalls,
      }),
    );
  });

  it('sem evidência do run (mensagem do sistema) não confere', async () => {
    const { tool, factCheck } = make();

    await tool.execute({ text: 'O Epcot abre às 10h.' }, CTX);

    expect(factCheck.scheduleAfterSend).not.toHaveBeenCalled();
  });

  it('mensagem bloqueada não é conferida', async () => {
    const { tool, factCheck } = make({ blockCommercialTalk: true });

    await tool.execute({ text: 'Custa R$ 699' }, { ...CTX, outboundGuards: GUARDS });

    expect(factCheck.scheduleAfterSend).not.toHaveBeenCalled();
  });
});
