import { NotificationType } from '@prisma/client';
import { SellerAlertService } from './seller-alert.service';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../database/prisma.service';

describe('SellerAlertService', () => {
  const prisma = { conversation: { findUnique: jest.fn() } };
  const notifications = { notify: jest.fn() };
  const svc = new SellerAlertService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService,
  );
  const conv = (assignedToId: string | null) => ({
    assignedToId, organizationId: 'o1', contact: { name: 'Maria Silva', phone: '5511' },
  });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.conversation.findUnique.mockResolvedValue(conv('seller-1'));
  });

  it('atribuição sem dono anterior → CONVERSATION_ASSIGNED com push handoff para quem recebe', async () => {
    await svc.onConversationAssigned({ conversationId: 'c1', recipientId: 'seller-2', previousAssigneeId: null, actorId: 'admin' });
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: 'seller-2', organizationId: 'o1', type: NotificationType.CONVERSATION_ASSIGNED,
      title: 'Maria Silva',
      push: { kind: 'handoff', contactName: 'Maria Silva', conversationId: 'c1' },
    }));
  });

  it('com dono anterior → CONVERSATION_TRANSFERRED', async () => {
    await svc.onConversationAssigned({ conversationId: 'c1', recipientId: 'seller-2', previousAssigneeId: 'seller-1' });
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: NotificationType.CONVERSATION_TRANSFERRED, recipientId: 'seller-2',
    }));
  });

  it('quem se atribuiu sozinho não é avisado', async () => {
    await svc.onConversationAssigned({ conversationId: 'c1', recipientId: 'seller-2', previousAssigneeId: null, actorId: 'seller-2' });
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(prisma.conversation.findUnique).not.toHaveBeenCalled();
  });

  it('handoff da IA vai para o dono atual', async () => {
    await svc.onAiHandoff('c1');
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: 'seller-1', push: expect.objectContaining({ kind: 'handoff' }),
    }));
  });

  it('handoff da IA em conversa sem dono → ninguém (fica na fila do ADM)', async () => {
    prisma.conversation.findUnique.mockResolvedValue(conv(null));
    await svc.onAiHandoff('c1');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('recado do plantão e chamado de suporte vão para o dono', async () => {
    await svc.onSellerNote('c1');
    await svc.onSupportTicket('c1', '#S-0042');
    expect(notifications.notify).toHaveBeenNthCalledWith(1, expect.objectContaining({
      recipientId: 'seller-1', push: expect.objectContaining({ kind: 'seller_note' }),
    }));
    expect(notifications.notify).toHaveBeenNthCalledWith(2, expect.objectContaining({
      body: 'Chamado #S-0042 aberto', push: expect.objectContaining({ kind: 'support_ticket' }),
    }));
  });

  it('push nunca leva texto do cliente: só nome e conversa', async () => {
    await svc.onSellerNote('c1');
    const push = notifications.notify.mock.calls[0][0].push;
    expect(Object.keys(push).sort()).toEqual(['contactName', 'conversationId', 'kind']);
  });

  it('nunca lança', async () => {
    notifications.notify.mockRejectedValue(new Error('boom'));
    await expect(svc.onAiHandoff('c1')).resolves.toBeUndefined();
  });
});
