import { OrgOffHoursNoticeService } from './org-off-hours-notice.service';

describe('OrgOffHoursNoticeService', () => {
  const now = new Date('2026-07-26T03:00:00.000Z'); // fora de qualquer 09-18
  const makeConv = (over: any = {}) => ({
    id: 'c1', organizationId: 'o1', channelId: 'ch1', contactId: 'ct1',
    assignedToId: null, aiOffHoursMessageAt: null,
    contact: { channels: [{ channelId: 'ch1', externalId: '55119...' }] },
    ...over,
  });
  const makeOrg = (over: any = {}) => ({
    aiOffHoursMode: 'MESSAGE', aiTimezone: 'America/Sao_Paulo',
    aiBusinessHours: { monday: { enabled: true, windows: [['09:00', '18:00']] } },
    aiOutOfHoursMessage: 'Estamos fechados. Voltamos {proximo_horario}.',
    ...over,
  });
  let prisma: any, queue: any, realtime: any, svc: OrgOffHoursNoticeService;
  beforeEach(() => {
    prisma = {
      conversation: { findUnique: jest.fn(), update: jest.fn() },
      message: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
      organization: { findUnique: jest.fn() },
    };
    queue = { add: jest.fn() };
    realtime = { emitToChannel: jest.fn(), emitToConversation: jest.fn() };
    svc = new OrgOffHoursNoticeService(prisma, realtime, queue);
    (svc as any).clock = () => now;
  });

  it('MESSAGE + fora do horário + sem humano → envia 1x e carimba', async () => {
    prisma.conversation.findUnique.mockResolvedValue(makeConv());
    prisma.organization.findUnique.mockResolvedValue(makeOrg());
    await svc.onInboundReply('c1');
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith('send-outbound', expect.any(Object), expect.any(Object));
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ aiOffHoursMessageAt: now }) }),
    );
  });
  it('modo != MESSAGE → no-op', async () => {
    prisma.conversation.findUnique.mockResolvedValue(makeConv());
    prisma.organization.findUnique.mockResolvedValue(makeOrg({ aiOffHoursMode: 'ATTEND' }));
    await svc.onInboundReply('c1');
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
  it('humano já atribuído → no-op', async () => {
    prisma.conversation.findUnique.mockResolvedValue(makeConv({ assignedToId: 'u1' }));
    prisma.organization.findUnique.mockResolvedValue(makeOrg());
    await svc.onInboundReply('c1');
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
  it('já avisado neste período fechado → no-op', async () => {
    prisma.conversation.findUnique.mockResolvedValue(
      makeConv({ aiOffHoursMessageAt: new Date('2026-07-26T02:00:00.000Z') }),
    );
    prisma.organization.findUnique.mockResolvedValue(makeOrg());
    await svc.onInboundReply('c1');
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
  it('mensagem vazia → no-op', async () => {
    prisma.conversation.findUnique.mockResolvedValue(makeConv());
    prisma.organization.findUnique.mockResolvedValue(makeOrg({ aiOutOfHoursMessage: '   ' }));
    await svc.onInboundReply('c1');
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
});
