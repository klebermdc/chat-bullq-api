import { TransferToHumanTool } from './transfer-to-human.tool';

/**
 * Foco destes testes: o "handoff obrigatório" da spec — ao transferir, o resumo
 * do SDR (Aline) precisa virar OBSERVAÇÃO do lead (Contact.notes), pra o
 * atendente humano nunca começar do zero — mais os comportamentos do card de
 * distribuição: não expira (TTL longo), aparece na aba "Esperando"
 * (awaitingHumanReply) e não duplica quando já há um handoff pendente.
 */
function make(opts: {
  contact?: Record<string, unknown>;
  pending?: Array<{ id: string; toolName: string }>;
  conversation?: Record<string, unknown>;
} = {}) {
  const realtime = { emitToConversation: jest.fn() } as any;
  const pendingActions = {
    create: jest.fn().mockResolvedValue({ id: 'pa1' }),
    listPending: jest.fn().mockResolvedValue(opts.pending ?? []),
  } as any;
  const prisma = {
    contact: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ notes: null, ...(opts.contact ?? {}) }),
      update: jest.fn().mockResolvedValue({ id: 'ct1' }),
    },
    conversation: {
      update: jest.fn().mockResolvedValue({ id: 'conv1' }),
      findUnique: jest.fn().mockResolvedValue(opts.conversation ?? null),
    },
    // pipeline null → createVendasOfpCard degrada sem tocar em card.* (não é o foco)
    pipeline: { findFirst: jest.fn().mockResolvedValue(null) },
  } as any;
  const replyTool = { execute: jest.fn().mockResolvedValue(undefined) } as any;
  const ctx = {
    organizationId: 'org1',
    conversationId: 'conv1',
    contactId: 'ct1',
    agentId: 'a1',
    runId: 'r1',
  } as any;
  const tool = new TransferToHumanTool(realtime, pendingActions, prisma, replyTool);
  return { tool, prisma, pendingActions, replyTool, ctx };
}

describe('TransferToHumanTool — resumo do SDR vira observação do lead', () => {
  const SUMMARY =
    'Disney + Universal, 6 dias, viagem julho/2026, 2 adultos + 2 crianças (5 e 8).';

  it('grava o resumo em Contact.notes no handoff', async () => {
    const { tool, prisma, ctx } = make({ contact: { notes: null } });
    await tool.execute({ reason: 'lead qualificado', summary: SUMMARY }, ctx);

    expect(prisma.contact.update).toHaveBeenCalledTimes(1);
    const arg = prisma.contact.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'ct1' });
    expect(arg.data.notes).toContain(SUMMARY);
  });

  it('preserva observação existente (anexa, não sobrescreve)', async () => {
    const { tool, prisma, ctx } = make({
      contact: { notes: 'Cliente VIP — indicação da Ana.' },
    });
    await tool.execute({ reason: 'lead qualificado', summary: SUMMARY }, ctx);

    const arg = prisma.contact.update.mock.calls[0][0];
    expect(arg.data.notes).toContain('Cliente VIP — indicação da Ana.');
    expect(arg.data.notes).toContain(SUMMARY);
  });

  it('sem summary, NÃO grava observação (não polui com o motivo interno)', async () => {
    const { tool, prisma, ctx } = make();
    await tool.execute({ reason: 'cliente pediu atendente' }, ctx);

    expect(prisma.contact.update).not.toHaveBeenCalled();
  });
});

describe('TransferToHumanTool — msg de transição olha o horário da agência', () => {
  afterEach(() => jest.useRealTimers());

  const withHours = (t: ReturnType<typeof make>) => {
    t.prisma.organization = {
      findUnique: jest.fn().mockResolvedValue({
        aiBusinessHours: { monday: { enabled: true, windows: [['09:00', '18:00']] } },
        aiTimezone: 'America/Sao_Paulo',
      }),
    };
    return t;
  };

  it('FORA do horário: avisa o retorno e NÃO promete atendimento imediato', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-26T12:00:00.000Z')); // domingo 09h BRT → fechado
    const t = withHours(make());
    await t.tool.execute({ reason: 'lead qualificado' }, t.ctx);

    const text = t.replyTool.execute.mock.calls[0][0].text as string;
    expect(text.toLowerCase()).toContain('fora do horário');
    expect(text).not.toContain('Em instantes alguém continua');
  });

  it('DENTRO do horário: mantém a mensagem padrão', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-27T13:00:00.000Z')); // segunda 10h BRT → aberto
    const t = withHours(make());
    await t.tool.execute({ reason: 'lead qualificado' }, t.ctx);

    const text = t.replyTool.execute.mock.calls[0][0].text as string;
    expect(text).toContain('Em instantes alguém continua');
  });

  it('sem org/horário no mock (lookup falha): cai na mensagem padrão', async () => {
    const { tool, replyTool, ctx } = make(); // prisma sem organization
    await tool.execute({ reason: 'lead qualificado' }, ctx);

    const text = replyTool.execute.mock.calls[0][0].text as string;
    expect(text).toContain('Em instantes alguém continua');
  });
});

describe('TransferToHumanTool — card de distribuição (não expira / Esperando / dedupe)', () => {
  it('cria a pendência com TTL longo (não expira em 30min)', async () => {
    const { tool, pendingActions, ctx } = make();
    await tool.execute({ reason: 'lead qualificado' }, ctx);

    expect(pendingActions.create).toHaveBeenCalledTimes(1);
    const arg = pendingActions.create.mock.calls[0][0];
    // Bem acima do default de 30min — efetivamente "não expira".
    expect(arg.ttlMinutes).toBeGreaterThan(60 * 24 * 30);
  });

  it('marca a conversa como "Esperando" (awaitingHumanReply=true) no handoff', async () => {
    const { tool, prisma, ctx } = make();
    await tool.execute({ reason: 'lead qualificado' }, ctx);

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv1' },
      data: { awaitingHumanReply: true },
    });
  });

  it('NÃO duplica: se já há handoff PENDING na conversa, reusa e não cria outro', async () => {
    const { tool, pendingActions, prisma, replyTool, ctx } = make({
      pending: [{ id: 'pa-existente', toolName: 'transferToHuman' }],
    });
    const res = await tool.execute({ reason: 'de novo' }, ctx);

    expect(pendingActions.create).not.toHaveBeenCalled();
    // Não repete efeitos determinísticos (não re-avisa o cliente nem re-marca).
    expect(replyTool.execute).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect((res.output as any).pendingActionId).toBe('pa-existente');
    expect(res.finalAction).toBe('TRANSFERRED_TO_HUMAN');
  });

  it('procura o handoff pendente na org E na conversa (ordem dos argumentos)', async () => {
    // Regressão: listPending virou (organizationId, conversationId?) e a tool
    // seguia passando só o conversationId — que caía no lugar da org. A busca
    // nunca achava nada e o dedupe não funcionava (cards repetidos na tela).
    const { tool, pendingActions, ctx } = make();
    await tool.execute({ reason: 'lead qualificado' }, ctx);

    expect(pendingActions.listPending).toHaveBeenCalledWith('org1', 'conv1');
  });
});

describe('TransferToHumanTool — lead do site com dono (Aline até o handoff)', () => {
  it('entrega direto ao vendedor: sem pendência de distribuição, IA desligada', async () => {
    const { tool, prisma, pendingActions, replyTool, ctx } = make({
      conversation: { aiUntilHandoff: true, assignedToId: 'renata' },
    });

    const res = await tool.execute({ reason: 'qualificado', summary: 'Disney em julho' }, ctx);

    expect(res.finalAction).toBe('TRANSFERRED_TO_HUMAN');
    expect(pendingActions.create).not.toHaveBeenCalled();
    expect(replyTool.execute).toHaveBeenCalled();
    expect(prisma.contact.update).toHaveBeenCalled();
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv1' },
      data: expect.objectContaining({
        aiEnabled: false,
        activeAgentId: null,
        aiUntilHandoff: false,
        awaitingHumanReply: true,
      }),
    });
  });

  it('lead do site SEM dono segue o fluxo normal (fila Distribuir)', async () => {
    const { tool, pendingActions, ctx } = make({
      conversation: { aiUntilHandoff: true, assignedToId: null },
    });
    await tool.execute({ reason: 'qualificado' }, ctx);
    expect(pendingActions.create).toHaveBeenCalled();
  });
});

describe('TransferToHumanTool — ficha da Aline fixa na conversa', () => {
  const withRaw = (t: ReturnType<typeof make>) => {
    t.prisma.$executeRaw = jest.fn().mockResolvedValue(1);
    return t;
  };
  // $executeRaw recebe um Prisma.Sql: values = [ficha em JSON, conversationId].
  const sqlValues = (t: ReturnType<typeof make>) => t.prisma.$executeRaw.mock.calls[0][0].values;
  const briefArg = (t: ReturnType<typeof make>) => JSON.parse(sqlValues(t)[0]);

  const INPUT = {
    reason: 'lead qualificado',
    summary: 'Disney em julho',
    destination: 'Orlando',
    travelers: '2 adultos',
  };

  it('grava a ficha no metadata da conversa (fila Distribuir)', async () => {
    const t = withRaw(make());
    await t.tool.execute(INPUT, t.ctx);

    expect(t.prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(briefArg(t)).toMatchObject({
      summary: 'Disney em julho',
      destination: 'Orlando',
      travelers: '2 adultos',
    });
    expect(sqlValues(t)[1]).toBe('conv1');
  });

  it('grava a ficha também na entrega direta ao dono', async () => {
    const t = withRaw(make({ conversation: { aiUntilHandoff: true, assignedToId: 'renata' } }));
    await t.tool.execute(INPUT, t.ctx);

    expect(briefArg(t)).toMatchObject({ destination: 'Orlando' });
  });

  it('sem resumo nem campos, não grava ficha', async () => {
    const t = withRaw(make());
    await t.tool.execute({ reason: 'cliente pediu humano' }, t.ctx);

    expect(t.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('falha ao gravar a ficha não derruba a transferência', async () => {
    const t = make();
    t.prisma.$executeRaw = jest.fn().mockRejectedValue(new Error('db down'));
    const res = await t.tool.execute(INPUT, t.ctx);

    expect(res.finalAction).toBe('TRANSFERRED_TO_HUMAN');
    expect(t.pendingActions.create).toHaveBeenCalled();
  });

  it('expõe os campos estruturados no schema da tool', () => {
    const { tool } = make();
    const props = Object.keys((tool.parameters as any).properties);
    expect(props).toEqual(
      expect.arrayContaining(['destination', 'travelDates', 'travelers', 'budget', 'pendingQuestions']),
    );
  });
});
