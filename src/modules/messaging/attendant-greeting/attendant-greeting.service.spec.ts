import { AttendantGreetingService } from './attendant-greeting.service';

function makeDeps(overrides: any = {}) {
  const prisma = {
    conversation: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        organizationId: 'org1',
        isGroup: false,
      }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Bárbara Silva' }),
    },
    ...overrides.prisma,
  };
  const messages = { send: jest.fn().mockResolvedValue({ id: 'm1' }) };
  const settings = {
    get: jest.fn().mockResolvedValue({
      organizationId: 'org1',
      enabled: true,
      template: 'Oi! Sou o {atendente} e vou continuar seu atendimento 😊',
    }),
  };
  return { prisma, messages, settings };
}

describe('AttendantGreetingService', () => {
  it('envia a saudação com o 1º nome do atendente', async () => {
    const { prisma, messages, settings } = makeDeps();
    const svc = new AttendantGreetingService(
      prisma as any,
      messages as any,
      settings as any,
    );
    await svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'TRANSFER' });
    expect(messages.send).toHaveBeenCalledTimes(1);
    const [dto, senderId, orgId, access] = messages.send.mock.calls[0];
    expect(dto).toEqual({
      conversationId: 'c1',
      type: 'TEXT',
      content: { text: 'Oi! Sou o Bárbara e vou continuar seu atendimento 😊' },
    });
    expect(senderId).toBe('u1');
    expect(orgId).toBe('org1');
    expect(access).toBe('ALL');
  });

  it('não envia quando enabled=false', async () => {
    const { prisma, messages, settings } = makeDeps();
    settings.get.mockResolvedValue({ enabled: false, template: 'x' });
    const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);
    await svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'TRANSFER' });
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('não envia em conversa de grupo', async () => {
    const { prisma, messages, settings } = makeDeps();
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'c1', organizationId: 'org1', isGroup: true,
    });
    const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);
    await svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'TRANSFER' });
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('fallback "atendente" quando o usuário não tem nome', async () => {
    const { prisma, messages, settings } = makeDeps();
    prisma.user.findUnique.mockResolvedValue({ name: '  ' });
    const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);
    await svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'TRANSFER' });
    expect(messages.send.mock.calls[0][0].content.text).toContain('Sou o atendente');
  });

  it('engole erro de send (best-effort, não relança)', async () => {
    const { prisma, messages, settings } = makeDeps();
    messages.send.mockRejectedValue(new Error('24h window closed'));
    const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);
    await expect(
      svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'TRANSFER' }),
    ).resolves.toBeUndefined();
  });
});
