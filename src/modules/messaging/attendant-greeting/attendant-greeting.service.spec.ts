import { AttendantGreetingService } from './attendant-greeting.service';

function makeDeps(overrides: any = {}) {
  const prisma = {
    conversation: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        organizationId: 'org1',
        isGroup: false,
        metadata: {},
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Bárbara Silva' }),
    },
    messageTemplate: {
      findFirst: jest.fn().mockResolvedValue(null),
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
    const [dto, senderId, orgId, access, , opts] = messages.send.mock.calls[0];
    // Saudação não é resposta humana: não tira do Esperando nem cumpre SLA.
    expect(opts).toEqual({ system: true, automated: true });
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

  it('registra o atendente saudado no metadata da conversa', async () => {
    const { prisma, messages, settings } = makeDeps();
    const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);
    await svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'HANDOFF_APPROVE' });
    expect(prisma.conversation.update).toHaveBeenCalledTimes(1);
    const arg = prisma.conversation.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'c1' });
    expect(arg.data.metadata.attendantGreeting.userId).toBe('u1');
  });

  it('NÃO saúda de novo quando o mesmo atendente já se apresentou nesta conversa', async () => {
    const { prisma, messages, settings } = makeDeps();
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'c1',
      organizationId: 'org1',
      isGroup: false,
      metadata: { attendantGreeting: { userId: 'u1', at: '2026-07-27T10:00:00.000Z' } },
    });
    const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);
    await svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'MANUAL_ASSIGN' });
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('saúda quando quem assume é OUTRO atendente (preserva o resto do metadata)', async () => {
    const { prisma, messages, settings } = makeDeps();
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'c1',
      organizationId: 'org1',
      isGroup: false,
      metadata: {
        attendantGreeting: { userId: 'u1', at: '2026-07-27T10:00:00.000Z' },
        requestNotes: 'quer 3 dias de parque',
      },
    });
    const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);
    await svc.greet({ conversationId: 'c1', attendantUserId: 'u2', source: 'TRANSFER' });
    expect(messages.send).toHaveBeenCalledTimes(1);
    const data = prisma.conversation.update.mock.calls[0][0].data;
    expect(data.metadata.requestNotes).toBe('quer 3 dias de parque');
    expect(data.metadata.attendantGreeting.userId).toBe('u2');
  });

  it('engole erro de send (best-effort, não relança)', async () => {
    const { prisma, messages, settings } = makeDeps();
    messages.send.mockRejectedValue(new Error('24h window closed'));
    const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);
    await expect(
      svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'TRANSFER' }),
    ).resolves.toBeUndefined();
  });

  describe('janela de 24h fechada', () => {
    const HOUR = 60 * 60 * 1000;
    const closedConversation = (extra: Record<string, unknown> = {}) => ({
      id: 'c1',
      organizationId: 'org1',
      isGroup: false,
      metadata: {},
      channelId: 'ch1',
      lastInboundAt: new Date(Date.now() - 30 * HOUR),
      metaWindowExpiresAt: null,
      channel: { type: 'WHATSAPP_OFFICIAL' },
      contact: { name: 'Maria Souza', ctwaClidAt: null },
      ...extra,
    });
    const distributionTemplate = {
      id: 't1',
      name: 'distribuicao_vendedor',
      language: 'pt_BR',
      components: { body: { text: 'Oi {{1}}, aqui é {{2}} da OFP.' } },
      variableExamples: {},
    };

    it('envia o template de distribuição do canal com cliente e vendedor', async () => {
      const { prisma, messages, settings } = makeDeps();
      prisma.conversation.findUnique.mockResolvedValue(closedConversation());
      prisma.messageTemplate.findFirst.mockResolvedValue(distributionTemplate);
      const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);

      await svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'TRANSFER' });

      expect(prisma.messageTemplate.findFirst).toHaveBeenCalledWith({
        where: { channelId: 'ch1', isDistribution: true, status: 'APPROVED' },
      });
      expect(messages.send).toHaveBeenCalledTimes(1);
      const [dto, senderId, , , , opts] = messages.send.mock.calls[0];
      expect(senderId).toBe('u1');
      expect(opts).toEqual({ system: true, automated: true });
      expect(dto).toEqual({
        conversationId: 'c1',
        type: 'TEMPLATE',
        content: {
          name: 'distribuicao_vendedor',
          language: { code: 'pt_BR' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: 'Maria' },
                { type: 'text', text: 'Bárbara' },
              ],
            },
          ],
        },
      });
      const meta = prisma.conversation.update.mock.calls[0][0].data.metadata;
      expect(meta.attendantGreeting).toMatchObject({ userId: 'u1', kind: 'TEMPLATE' });
    });

    it('envia o template mesmo com a saudação em texto desligada', async () => {
      const { prisma, messages, settings } = makeDeps();
      settings.get.mockResolvedValue({ enabled: false, template: 'x' });
      prisma.conversation.findUnique.mockResolvedValue(closedConversation());
      prisma.messageTemplate.findFirst.mockResolvedValue(distributionTemplate);
      const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);

      await svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'DISTRIBUTE' });

      expect(messages.send.mock.calls[0][0].type).toBe('TEMPLATE');
    });

    it('não envia nada quando o canal não tem template de distribuição', async () => {
      const { prisma, messages, settings } = makeDeps();
      prisma.conversation.findUnique.mockResolvedValue(closedConversation());
      const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);

      await svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'TRANSFER' });

      expect(messages.send).not.toHaveBeenCalled();
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });

    it('não envia template com cabeçalho de mídia (não dá para preencher sozinho)', async () => {
      const { prisma, messages, settings } = makeDeps();
      prisma.conversation.findUnique.mockResolvedValue(closedConversation());
      prisma.messageTemplate.findFirst.mockResolvedValue({
        ...distributionTemplate,
        components: { header: { format: 'IMAGE' }, body: { text: 'Oi {{1}}' } },
      });
      const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);

      await svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'TRANSFER' });

      expect(messages.send).not.toHaveBeenCalled();
    });

    it('com a janela aberta segue mandando o texto de saudação', async () => {
      const { prisma, messages, settings } = makeDeps();
      prisma.conversation.findUnique.mockResolvedValue(
        closedConversation({ lastInboundAt: new Date(Date.now() - 2 * HOUR) }),
      );
      const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);

      await svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'TRANSFER' });

      expect(prisma.messageTemplate.findFirst).not.toHaveBeenCalled();
      expect(messages.send.mock.calls[0][0].type).toBe('TEXT');
    });

    it('onlyWhenWindowClosed: com a janela aberta não envia nada', async () => {
      const { prisma, messages, settings } = makeDeps();
      prisma.conversation.findUnique.mockResolvedValue(
        closedConversation({ lastInboundAt: new Date(Date.now() - 2 * HOUR) }),
      );
      const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);

      await svc.greet({
        conversationId: 'c1',
        attendantUserId: 'u1',
        source: 'DISTRIBUTE',
        onlyWhenWindowClosed: true,
      });

      expect(messages.send).not.toHaveBeenCalled();
    });

    it('não repete o template para o mesmo vendedor na mesma conversa', async () => {
      const { prisma, messages, settings } = makeDeps();
      prisma.conversation.findUnique.mockResolvedValue(
        closedConversation({ metadata: { attendantGreeting: { userId: 'u1' } } }),
      );
      prisma.messageTemplate.findFirst.mockResolvedValue(distributionTemplate);
      const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);

      await svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'HANDOFF_APPROVE' });

      expect(messages.send).not.toHaveBeenCalled();
    });
  });
});
