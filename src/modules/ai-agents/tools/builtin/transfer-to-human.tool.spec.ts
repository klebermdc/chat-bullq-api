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
    conversation: { update: jest.fn().mockResolvedValue({ id: 'conv1' }) },
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
});
