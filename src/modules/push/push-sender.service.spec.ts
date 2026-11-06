import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PushSenderService } from './push-sender.service';
import { PushSubscriptionsService } from './push-subscriptions.service';

jest.mock('web-push', () => ({ sendNotification: jest.fn() }));

const send = webpush.sendNotification as jest.Mock;
const payload = { title: 'Maria', body: 'mandou mensagem', tag: 'conv:c1', href: '/inbox?conversationId=c1' };
const VAPID = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:x@y.com' };

function build(env: Record<string, string>, rows: Array<{ id: string; endpoint: string }>) {
  const subs = {
    listActive: jest.fn().mockResolvedValue(rows.map((r) => ({ ...r, p256dhKey: 'p', authKey: 'a' }))),
    removeById: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  return { svc: new PushSenderService(config, subs as unknown as PushSubscriptionsService), subs };
}

describe('PushSenderService', () => {
  beforeEach(() => send.mockReset());

  it('sem chaves VAPID: desligado, não lista nem envia', async () => {
    const { svc, subs } = build({}, [{ id: 's1', endpoint: 'https://fcm.googleapis.com/x' }]);
    expect(svc.isEnabled()).toBe(false);
    expect(svc.publicKey()).toBeNull();
    await expect(svc.sendToUser('u1', 'o1', payload)).resolves.toEqual({ sent: 0, gone: 0, failed: 0 });
    expect(subs.listActive).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('envia o payload em JSON com as chaves da inscrição', async () => {
    send.mockResolvedValue({});
    const { svc } = build(VAPID, [{ id: 's1', endpoint: 'https://fcm.googleapis.com/x' }]);
    await expect(svc.sendToUser('u1', 'o1', payload)).resolves.toEqual({ sent: 1, gone: 0, failed: 0 });
    expect(send).toHaveBeenCalledWith(
      { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } },
      JSON.stringify(payload),
      expect.objectContaining({ TTL: 3600, urgency: 'high', vapidDetails: expect.objectContaining({ publicKey: 'pub' }) }),
    );
  });

  it('ignora endpoint fora dos serviços conhecidos (anti-SSRF)', async () => {
    const { svc } = build(VAPID, [{ id: 's1', endpoint: 'https://169.254.169.254/x' }]);
    await svc.sendToUser('u1', 'o1', payload);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([404, 410])('apaga a inscrição morta (%s)', async (statusCode) => {
    send.mockRejectedValue({ statusCode });
    const { svc, subs } = build(VAPID, [{ id: 's1', endpoint: 'https://web.push.apple.com/x' }]);
    await expect(svc.sendToUser('u1', 'o1', payload)).resolves.toEqual({ sent: 0, gone: 1, failed: 0 });
    expect(subs.removeById).toHaveBeenCalledWith('s1');
  });

  it('outro erro: mantém a inscrição e segue para as demais', async () => {
    send.mockRejectedValueOnce({ statusCode: 500 }).mockResolvedValueOnce({});
    const { svc, subs } = build(VAPID, [
      { id: 's1', endpoint: 'https://fcm.googleapis.com/a' },
      { id: 's2', endpoint: 'https://fcm.googleapis.com/b' },
    ]);
    await expect(svc.sendToUser('u1', 'o1', payload)).resolves.toEqual({ sent: 1, gone: 0, failed: 1 });
    expect(subs.removeById).not.toHaveBeenCalled();
  });
});
