import { TransferToHumanTool } from './transfer-to-human.tool';

/**
 * Foco destes testes: o "handoff obrigatório" da spec — ao transferir, o resumo
 * do SDR (Aline) precisa virar OBSERVAÇÃO do lead (Contact.notes), pra o
 * atendente humano nunca começar do zero. Os demais efeitos (reply, card,
 * pending action) são best-effort e cobertos noutros pontos.
 */
function make(contactOverrides: Record<string, unknown> = {}) {
  const realtime = { emitToConversation: jest.fn() } as any;
  const pendingActions = {
    create: jest.fn().mockResolvedValue({ id: 'pa1' }),
  } as any;
  const prisma = {
    contact: {
      findUnique: jest.fn().mockResolvedValue({ notes: null, ...contactOverrides }),
      update: jest.fn().mockResolvedValue({ id: 'ct1' }),
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
  return { tool, prisma, ctx, replyTool };
}

describe('TransferToHumanTool — resumo do SDR vira observação do lead', () => {
  const SUMMARY =
    'Disney + Universal, 6 dias, viagem julho/2026, 2 adultos + 2 crianças (5 e 8).';

  it('grava o resumo em Contact.notes no handoff', async () => {
    const { tool, prisma, ctx } = make({ notes: null });
    await tool.execute({ reason: 'lead qualificado', summary: SUMMARY }, ctx);

    expect(prisma.contact.update).toHaveBeenCalledTimes(1);
    const arg = prisma.contact.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'ct1' });
    expect(arg.data.notes).toContain(SUMMARY);
  });

  it('preserva observação existente (anexa, não sobrescreve)', async () => {
    const { tool, prisma, ctx } = make({ notes: 'Cliente VIP — indicação da Ana.' });
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
