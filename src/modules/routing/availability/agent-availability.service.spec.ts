import { AgentAvailabilityService } from './agent-availability.service';

const TZ = 'America/Sao_Paulo';
const spDate = (isoLocal: string) => new Date(`${isoLocal}-03:00`);
const NINE_TO_SIX = {
  monday: { enabled: true, windows: [['09:00', '18:00']] },
  tuesday: { enabled: true, windows: [['09:00', '18:00']] },
  wednesday: { enabled: true, windows: [['09:00', '18:00']] },
  thursday: { enabled: true, windows: [['09:00', '18:00']] },
  friday: { enabled: true, windows: [['09:00', '18:00']] },
  saturday: { enabled: false },
  sunday: { enabled: false },
};

function buildConversation(over: any = {}) {
  return {
    id: 'conv1', organizationId: 'org1', assignedToId: 'user1',
    offHoursNoticeAt: null, ...over,
  };
}

function makeService(deps: {
  conversation: any;
  membership?: any;
  org?: any;
  now: Date;
}) {
  const prisma = {
    conversation: {
      findUnique: jest.fn().mockResolvedValue(deps.conversation),
      update: jest.fn().mockResolvedValue({}),
    },
    userOrganization: {
      findUnique: jest.fn().mockResolvedValue(
        deps.membership ?? {
          userId: 'user1',
          workingHours: NINE_TO_SIX,
          offHoursNoticeEnabled: true,
          user: { name: 'João Silva' },
        },
      ),
    },
    organization: {
      findUnique: jest.fn().mockResolvedValue(
        deps.org ?? { aiTimezone: TZ, offHoursMessageTemplate: null },
      ),
    },
  } as any;
  const messages = { send: jest.fn().mockResolvedValue({ id: 'msg1' }) } as any;
  const svc = new AgentAvailabilityService(prisma, messages);
  (svc as any).clock = () => deps.now; // injeta "agora" nos testes
  return { svc, prisma, messages };
}

describe('AgentAvailabilityService.onInboundReply', () => {
  it('sem atendente assumido -> no-op', async () => {
    const { svc, messages } = makeService({
      conversation: buildConversation({ assignedToId: null }),
      now: spDate('2026-07-22T20:00:00'),
    });
    await svc.onInboundReply('conv1');
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('aviso desligado -> no-op', async () => {
    const { svc, messages } = makeService({
      conversation: buildConversation(),
      membership: { userId: 'user1', workingHours: NINE_TO_SIX, offHoursNoticeEnabled: false, user: { name: 'João' } },
      now: spDate('2026-07-22T20:00:00'),
    });
    await svc.onInboundReply('conv1');
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('dentro do horário -> no-op', async () => {
    const { svc, messages } = makeService({
      conversation: buildConversation(),
      now: spDate('2026-07-22T10:00:00'),
    });
    await svc.onInboundReply('conv1');
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('fora do horário, nunca avisado -> envia e carimba', async () => {
    const now = spDate('2026-07-22T20:00:00');
    const { svc, messages, prisma } = makeService({
      conversation: buildConversation(),
      now,
    });
    await svc.onInboundReply('conv1');
    expect(messages.send).toHaveBeenCalledTimes(1);
    const [dto, senderId, orgId] = messages.send.mock.calls[0];
    expect(dto.type).toBe('TEXT');
    expect(dto.content.text).toContain('João'); // primeiro nome
    expect(dto.content.text).toContain('amanhã às 09h'); // próximo horário
    expect(senderId).toBe('user1');
    expect(orgId).toBe('org1');
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv1' },
      data: { offHoursNoticeAt: now },
    });
  });

  it('fora do horário, já avisado neste período -> skip (dedup)', async () => {
    const { svc, messages } = makeService({
      conversation: buildConversation({ offHoursNoticeAt: spDate('2026-07-22T19:00:00') }),
      now: spDate('2026-07-22T22:00:00'),
    });
    await svc.onInboundReply('conv1');
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('fora do horário, avisado em período anterior -> reenvia', async () => {
    const { svc, messages } = makeService({
      conversation: buildConversation({ offHoursNoticeAt: spDate('2026-07-21T20:00:00') }),
      now: spDate('2026-07-22T20:00:00'),
    });
    await svc.onInboundReply('conv1');
    expect(messages.send).toHaveBeenCalledTimes(1);
  });

  it('falha no envio -> não carimba', async () => {
    const { svc, prisma, messages } = makeService({
      conversation: buildConversation(),
      now: spDate('2026-07-22T20:00:00'),
    });
    messages.send.mockRejectedValueOnce(new Error('boom'));
    await svc.onInboundReply('conv1');
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });
});
