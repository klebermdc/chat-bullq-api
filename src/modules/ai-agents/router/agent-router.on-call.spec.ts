import { AgentRouterService } from './agent-router.service';

const ON_CALL = { sellerName: 'Pedro', returnAt: 'amanhã às 9h' };

// Conversa atribuída a um vendedor: a IA está desligada nela (aiEnabled=false).
const ASSIGNED = {
  id: 'conv1',
  organizationId: 'org1',
  channelId: 'ch1',
  aiEnabled: false,
  activeAgentId: null,
  assignedToId: 'user-pedro',
  lastHumanReplyAt: null,
} as any;

function make(
  overrides: {
    onCall?: unknown;
    org?: Record<string, unknown>;
    channel?: Record<string, unknown>;
    agentLink?: unknown;
    tokensUsed?: number;
  } = {},
) {
  const prisma = {
    channel: { findUnique: jest.fn().mockResolvedValue({ aiEnabled: null, ...overrides.channel }) },
    organization: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'org1',
        aiEnabled: true,
        // Org sempre fechada: o plantão NÃO obedece ao horário da org.
        aiBusinessHours: { monday: { enabled: false } },
        aiTimezone: 'America/Sao_Paulo',
        aiMonthlyTokenCap: null,
        aiOffHoursMode: 'SILENT',
        ...overrides.org,
      }),
    },
    aiAgentChannel: {
      findFirst: jest
        .fn()
        .mockResolvedValue(overrides.agentLink === undefined ? { id: 'link1' } : overrides.agentLink),
    },
    aiAgentRun: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { inputTokens: overrides.tokensUsed ?? 0, outputTokens: 0 },
      }),
    },
  } as any;
  const onCall = {
    evaluate: jest.fn().mockResolvedValue(overrides.onCall === undefined ? ON_CALL : overrides.onCall),
  } as any;
  return { svc: new AgentRouterService(prisma, {} as any, {} as any, onCall), prisma, onCall };
}

describe('AgentRouterService.shouldHandle — Aline de plantão', () => {
  it('libera a IA na conversa do vendedor fora do horário, em modo plantão', async () => {
    const { svc } = make();

    const result = await svc.shouldHandle(ASSIGNED);

    expect(result).toEqual({ handle: true, onCall: ON_CALL, reason: 'assignee-off-hours' });
  });

  it('mantém a IA desligada quando o plantão não se aplica', async () => {
    const { svc } = make({ onCall: null });

    expect(await svc.shouldHandle(ASSIGNED)).toEqual({
      handle: false,
      reason: 'conversation.aiEnabled=force-off',
    });
  });

  it('respeita a IA desligada na organização inteira', async () => {
    const { svc } = make({ org: { aiEnabled: false } });

    expect((await svc.shouldHandle(ASSIGNED)).handle).toBe(false);
  });

  it('respeita a IA desligada no canal', async () => {
    const { svc } = make({ channel: { aiEnabled: false } });

    expect((await svc.shouldHandle(ASSIGNED)).handle).toBe(false);
  });

  it('precisa de um agente ligado ao canal', async () => {
    const { svc } = make({ agentLink: null });

    expect(await svc.shouldHandle(ASSIGNED)).toEqual({
      handle: false,
      reason: 'no-agent-for-channel',
    });
  });

  it('respeita o teto mensal de tokens', async () => {
    const { svc } = make({ org: { aiMonthlyTokenCap: 100 }, tokensUsed: 500 });

    expect(await svc.shouldHandle(ASSIGNED)).toEqual({
      handle: false,
      reason: 'monthly-token-cap-reached',
    });
  });

  it('não consulta o plantão em conversa sem vendedor', async () => {
    const { svc, onCall } = make();

    await svc.shouldHandle({ ...ASSIGNED, assignedToId: null });

    expect(onCall.evaluate).not.toHaveBeenCalled();
  });
});
