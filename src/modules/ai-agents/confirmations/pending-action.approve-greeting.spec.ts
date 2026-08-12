import { PendingActionService } from './pending-action.service';

function make(actionOverrides: Record<string, unknown> = {}, convo: any = {}) {
  const action: any = {
    id: 'pa1',
    organizationId: 'org1',
    conversationId: 'conv1',
    toolName: 'transferToHuman',
    status: 'PENDING',
    args: {},
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    preview: { impact: 'critical' },
    ...actionOverrides,
  };
  const storage = {
    get: jest.fn().mockResolvedValue(action),
    save: jest.fn().mockResolvedValue(undefined),
  } as any;
  const queue = { add: jest.fn().mockResolvedValue(undefined) } as any;
  const prisma = {
    conversation: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ assignedToId: null, ...convo }),
    },
  } as any;
  const attendantGreeting = { greet: jest.fn().mockResolvedValue(undefined) };
  return {
    svc: new PendingActionService(storage, queue, prisma, attendantGreeting as any),
    storage,
    prisma,
    action,
    attendantGreeting,
  };
}

describe('PendingActionService.approve — saudação do atendente', () => {
  it('saúda com o atendente da distribuição quando a pendência foi distribuída', async () => {
    const { svc, attendantGreeting } = make({
      args: { distributedTo: 'atendente9' },
    });

    await svc.approve('pa1', 'org1', 'operador1');

    expect(attendantGreeting.greet).toHaveBeenCalledTimes(1);
    expect(attendantGreeting.greet).toHaveBeenCalledWith({
      conversationId: 'conv1',
      // Quem se apresenta é quem VAI atender (o distribuído), não quem clicou:
      // se o ADM aprova pelo atendente, o cliente não pode receber o nome do ADM.
      attendantUserId: 'atendente9',
      source: 'HANDOFF_APPROVE',
    });
  });

  it('saúda no approve de handoff SEM distribuição, usando o responsável da conversa', async () => {
    const { svc, attendantGreeting } = make(
      { args: { reason: 'cliente pediu humano' } },
      { assignedToId: 'atendente7' },
    );

    await svc.approve('pa1', 'org1', 'operador1');

    expect(attendantGreeting.greet).toHaveBeenCalledWith({
      conversationId: 'conv1',
      attendantUserId: 'atendente7',
      source: 'HANDOFF_APPROVE',
    });
  });

  it('saúda com quem aprovou quando a conversa ainda não tem responsável', async () => {
    const { svc, attendantGreeting } = make(
      { args: { reason: 'cliente pediu humano' } },
      { assignedToId: null },
    );

    await svc.approve('pa1', 'org1', 'operador1');

    expect(attendantGreeting.greet).toHaveBeenCalledWith({
      conversationId: 'conv1',
      attendantUserId: 'operador1',
      source: 'HANDOFF_APPROVE',
    });
  });

  it('NÃO chama attendantGreeting.greet numa aprovação genérica de outra tool', async () => {
    const { svc, attendantGreeting } = make({
      toolName: 'grantAccess',
      args: { someOtherArg: true },
    });

    await svc.approve('pa1', 'org1', 'operador1');

    expect(attendantGreeting.greet).not.toHaveBeenCalled();
  });

  it('NÃO chama attendantGreeting.greet quando não há conversationId', async () => {
    const { svc, attendantGreeting } = make({
      conversationId: undefined,
      args: { distributedTo: 'atendente9' },
    });

    await svc.approve('pa1', 'org1', 'operador1');

    expect(attendantGreeting.greet).not.toHaveBeenCalled();
  });

  it('não quebra a aprovação se a busca do responsável falhar (cai pra quem aprovou)', async () => {
    const { svc, prisma, attendantGreeting } = make({
      args: { reason: 'x' },
    });
    prisma.conversation.findUnique.mockRejectedValue(new Error('db down'));

    const result = await svc.approve('pa1', 'org1', 'operador1');

    expect(result.status).toBe('APPROVED');
    expect(attendantGreeting.greet).toHaveBeenCalledWith({
      conversationId: 'conv1',
      attendantUserId: 'operador1',
      source: 'HANDOFF_APPROVE',
    });
  });
});
