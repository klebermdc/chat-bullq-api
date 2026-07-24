import { Test } from '@nestjs/testing';
import { InboundNotifierService } from './inbound-notifier.service';
import { NotificationsService } from './notifications.service';
import { NotificationType, OrgRole } from '@prisma/client';

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

  it('conversa atribuída → notifica SÓ o atendente dono (não a org)', async () => {
    await svc.onInboundMessage({ ...base, assignedToId: 'agent-9' });
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: 'agent-9', organizationId: 'o1', type: NotificationType.NEW_MESSAGE,
      data: expect.objectContaining({ conversationId: 'c1' }),
    }));
    expect(notifications.notifyOrgAgents).not.toHaveBeenCalled();
  });

  it('sem dono, 1ª mensagem (lead novo) → notifica SÓ o OWNER', async () => {
    await svc.onInboundMessage({ ...base, assignedToId: null, isNewConversation: true });
    expect(notifications.notifyOrgAgents).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'o1', roles: [OrgRole.OWNER], type: NotificationType.NEW_MESSAGE,
    }));
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('sem dono, mensagem seguinte → não notifica ninguém (sem barulho na fila)', async () => {
    await svc.onInboundMessage({ ...base, assignedToId: null, isNewConversation: false });
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(notifications.notifyOrgAgents).not.toHaveBeenCalled();
  });

  it('nunca lança — erros são engolidos (best-effort)', async () => {
    notifications.notify.mockRejectedValueOnce(new Error('boom'));
    await expect(
      svc.onInboundMessage({ ...base, assignedToId: 'agent-9' }),
    ).resolves.toBeUndefined();
  });
});
