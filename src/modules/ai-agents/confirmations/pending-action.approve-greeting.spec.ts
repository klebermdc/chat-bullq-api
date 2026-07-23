import { PendingActionService } from './pending-action.service';

function make(actionOverrides: Record<string, unknown> = {}) {
  const action: any = {
    id: 'pa1',
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
  const prisma = {} as any;
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
  it('chama attendantGreeting.greet quando a pendência foi distribuída (tem conversationId + args.distributedTo)', async () => {
    const { svc, attendantGreeting } = make({
      args: { distributedTo: 'atendente9' },
    });

    await svc.approve('pa1', 'operador1');

    expect(attendantGreeting.greet).toHaveBeenCalledTimes(1);
    expect(attendantGreeting.greet).toHaveBeenCalledWith({
      conversationId: 'conv1',
      attendantUserId: 'operador1',
      source: 'HANDOFF_APPROVE',
    });
  });

  it('NÃO chama attendantGreeting.greet numa aprovação genérica sem args.distributedTo', async () => {
    const { svc, attendantGreeting } = make({
      args: { someOtherArg: true },
    });

    await svc.approve('pa1', 'operador1');

    expect(attendantGreeting.greet).not.toHaveBeenCalled();
  });

  it('NÃO chama attendantGreeting.greet quando tem distributedTo mas sem conversationId', async () => {
    const { svc, attendantGreeting } = make({
      conversationId: undefined,
      args: { distributedTo: 'atendente9' },
    });

    await svc.approve('pa1', 'operador1');

    expect(attendantGreeting.greet).not.toHaveBeenCalled();
  });
});
