import { Test } from '@nestjs/testing';
import { InboundNotifierService } from './inbound-notifier.service';
import { NotificationsService } from './notifications.service';
import { NotificationType } from '@prisma/client';

describe('InboundNotifierService', () => {
  let svc: InboundNotifierService;
  const notifications = { notify: jest.fn(), notifyOrgAgents: jest.fn() };

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        InboundNotifierService,
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    svc = mod.get(InboundNotifierService);
    jest.clearAllMocks();
  });

  const base = {
    organizationId: 'o1', conversationId: 'c1', contactName: 'João',
    preview: 'oi', assignedToId: null as string | null, isNewConversation: false,
  };

  it('conversa atribuída → notifica a org toda (não só o atendente)', async () => {
    await svc.onInboundMessage({ ...base, assignedToId: 'agent-9' });
    expect(notifications.notifyOrgAgents).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'o1', type: NotificationType.NEW_MESSAGE,
      data: expect.objectContaining({ conversationId: 'c1' }),
    }));
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('sem atribuição, 1ª mensagem → notifica a org', async () => {
    await svc.onInboundMessage({ ...base, assignedToId: null, isNewConversation: true });
    expect(notifications.notifyOrgAgents).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'o1', type: NotificationType.NEW_MESSAGE,
    }));
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('sem atribuição, mensagem seguinte → TAMBÉM notifica a org (não fica mudo)', async () => {
    await svc.onInboundMessage({ ...base, assignedToId: null, isNewConversation: false });
    expect(notifications.notifyOrgAgents).toHaveBeenCalledTimes(1);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('nunca lança — erros são engolidos (best-effort)', async () => {
    notifications.notifyOrgAgents.mockRejectedValueOnce(new Error('boom'));
    await expect(
      svc.onInboundMessage({ ...base, assignedToId: 'agent-9' }),
    ).resolves.toBeUndefined();
  });
});
