import { NotFoundException } from '@nestjs/common';
import { NotificationsRepository } from './notifications.repository';

describe('NotificationsRepository.markRead — escopo por dono + org', () => {
  function make(found: unknown) {
    const prisma: any = {
      notification: {
        findFirst: jest.fn().mockResolvedValue(found),
        update: jest.fn().mockResolvedValue({ id: 'n1', isRead: true }),
      },
    };
    return { repo: new NotificationsRepository(prisma), prisma };
  }

  it('id de outro usuário/org → NotFound, sem chamar update', async () => {
    const { repo, prisma } = make(null);
    await expect(repo.markRead('n1', 'u1', 'org1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.notification.findFirst).toHaveBeenCalledWith({
      where: { id: 'n1', recipientId: 'u1', organizationId: 'org1' },
      select: { id: true },
    });
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('notificação do próprio usuário/org → marca lida', async () => {
    const { repo, prisma } = make({ id: 'n1' });
    const result = await repo.markRead('n1', 'u1', 'org1');
    expect(result).toEqual({ id: 'n1', isRead: true });
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { isRead: true, readAt: expect.any(Date) },
    });
  });
});
