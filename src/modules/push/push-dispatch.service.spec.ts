import { NotificationType } from '@prisma/client';
import { PushDispatchService } from './push-dispatch.service';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { PushSenderService } from './push-sender.service';

describe('PushDispatchService', () => {
  const prisma = {
    userOrganization: { findUnique: jest.fn() },
    notificationPreference: { findUnique: jest.fn() },
    organization: { findUnique: jest.fn() },
  };
  const realtime = { hasOpenSession: jest.fn() };
  const sender = { isEnabled: jest.fn(), sendToUser: jest.fn() };
  const svc = new PushDispatchService(
    prisma as unknown as PrismaService,
    realtime as unknown as RealtimeGateway,
    sender as unknown as PushSenderService,
  );
  const input = {
    recipientId: 'u1',
    organizationId: 'o1',
    type: NotificationType.NEW_MESSAGE,
    intent: { kind: 'message' as const, contactName: 'Maria Silva', conversationId: 'c1' },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    sender.isEnabled.mockReturnValue(true);
    sender.sendToUser.mockResolvedValue({ sent: 1, gone: 0, failed: 0 });
    realtime.hasOpenSession.mockResolvedValue(false);
    prisma.userOrganization.findUnique.mockResolvedValue({ userId: 'u1' });
    prisma.notificationPreference.findUnique.mockResolvedValue(null);
    prisma.organization.findUnique.mockResolvedValue({ aiTimezone: null });
  });

  it('vendedor offline, sem preferência salva → envia só nome + frase fixa', async () => {
    await expect(svc.dispatch(input)).resolves.toBe('sent');
    expect(sender.sendToUser).toHaveBeenCalledWith('u1', 'o1', {
      title: 'Maria Silva', body: 'mandou mensagem', tag: 'conv:c1', href: '/inbox?conversationId=c1',
    });
  });

  it('Sendtur aberto nesta empresa → sem push', async () => {
    realtime.hasOpenSession.mockResolvedValue(true);
    await expect(svc.dispatch(input)).resolves.toBe('online');
    expect(sender.sendToUser).not.toHaveBeenCalled();
  });

  it('sem chaves VAPID → desligado, sem consultar nada', async () => {
    sender.isEnabled.mockReturnValue(false);
    await expect(svc.dispatch(input)).resolves.toBe('disabled');
    expect(realtime.hasOpenSession).not.toHaveBeenCalled();
  });

  it('push do tipo desligado nas preferências → sem push', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue({
      type: NotificationType.NEW_MESSAGE, browserPush: false, dndStart: null, dndEnd: null,
    });
    await expect(svc.dispatch(input)).resolves.toBe('muted');
    expect(sender.sendToUser).not.toHaveBeenCalled();
  });

  it('Não-Perturbe de dia inteiro → sem push', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue({
      type: NotificationType.NEW_MESSAGE, browserPush: true, dndStart: '00:00', dndEnd: '23:59',
    });
    await expect(svc.dispatch(input)).resolves.toBe('muted');
  });

  it('quem saiu da empresa não recebe', async () => {
    prisma.userOrganization.findUnique.mockResolvedValue(null);
    await expect(svc.dispatch(input)).resolves.toBe('not_member');
    expect(sender.sendToUser).not.toHaveBeenCalled();
  });

  it('nenhum aparelho inscrito → no_device', async () => {
    sender.sendToUser.mockResolvedValue({ sent: 0, gone: 0, failed: 0 });
    await expect(svc.dispatch(input)).resolves.toBe('no_device');
  });
});
