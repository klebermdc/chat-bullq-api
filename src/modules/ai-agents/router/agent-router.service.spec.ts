import { AgentRouterService } from './agent-router.service';

describe('AgentRouterService.shouldHandle — aiOffHoursMode', () => {
  // Org com aiBusinessHours SEMPRE fechado: só "monday" existe e está
  // desabilitado, então qualquer dia da semana cai em [] (fora do horário),
  // independente do relógio.
  const alwaysClosedHours = { monday: { enabled: false } };

  function makeOrg(overrides: Record<string, any> = {}) {
    return {
      id: 'org1',
      aiEnabled: true,
      aiBusinessHours: alwaysClosedHours,
      aiTimezone: 'America/Sao_Paulo',
      aiMonthlyTokenCap: null,
      aiOffHoursMode: 'SILENT',
      ...overrides,
    };
  }

  function make(orgOverrides: Record<string, any> = {}) {
    const prisma = {
      channel: {
        // sem override no canal (nem force-on nem force-off)
        findUnique: jest.fn().mockResolvedValue({ aiEnabled: null }),
      },
      organization: {
        findUnique: jest.fn().mockResolvedValue(makeOrg(orgOverrides)),
      },
    } as any;
    const svc = new AgentRouterService(prisma, {} as any, {} as any);
    return { svc, prisma };
  }

  // conversa sem override de IA (null) e com agente ativo já resolvido
  // (activeAgentId) — assim não precisamos mockar aiAgentChannel.findFirst.
  const conversation = {
    id: 'conv1',
    organizationId: 'org1',
    channelId: 'ch1',
    aiEnabled: null,
    activeAgentId: 'agent1',
  } as any;

  it('ATTEND: atende fora do horário (handle: true)', async () => {
    const { svc } = make({ aiOffHoursMode: 'ATTEND' });
    const result = await svc.shouldHandle(conversation);
    expect(result.handle).toBe(true);
    expect(result.reason).not.toBe('outside-business-hours');
  });

  it('SILENT: bloqueia fora do horário (outside-business-hours)', async () => {
    const { svc } = make({ aiOffHoursMode: 'SILENT' });
    const result = await svc.shouldHandle(conversation);
    expect(result).toEqual({ handle: false, reason: 'outside-business-hours' });
  });
});
