import { PushSubscriptionsService, STALE_SUBSCRIPTION_DAYS } from './push-subscriptions.service';
import { PrismaService } from '../../database/prisma.service';

describe('PushSubscriptionsService', () => {
  const prisma = {
    pushSubscription: {
      upsert: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const svc = new PushSubscriptionsService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('upsert pelo endpoint e passa a linha para quem está logado agora', async () => {
    await svc.upsert({
      userId: 'u2', organizationId: 'o1', endpoint: 'https://fcm.googleapis.com/x',
      p256dhKey: 'p', authKey: 'a', userAgent: 'UA',
    });
    const arg = prisma.pushSubscription.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ endpoint: 'https://fcm.googleapis.com/x' });
    expect(arg.update).toEqual(expect.objectContaining({ userId: 'u2', organizationId: 'o1', lastSeenAt: expect.any(Date) }));
  });

  it('remove só a inscrição de quem pede', async () => {
    await svc.removeForUser('u1', 'https://fcm.googleapis.com/x');
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', endpoint: 'https://fcm.googleapis.com/x' },
    });
  });

  it('descarta inscrições paradas há 30 dias antes de listar', async () => {
    const now = new Date('2026-11-07T12:00:00Z');
    await svc.listActive('u1', 'o1', now);
    const cutoff = prisma.pushSubscription.deleteMany.mock.calls[0][0].where.lastSeenAt.lt as Date;
    expect(now.getTime() - cutoff.getTime()).toBe(STALE_SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
    expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', organizationId: 'o1' } }),
    );
  });
});
