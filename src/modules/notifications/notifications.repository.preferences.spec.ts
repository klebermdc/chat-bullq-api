import { Test } from '@nestjs/testing';
import { NotificationsRepository } from './notifications.repository';
import { PrismaService } from '../../database/prisma.service';
import { NotificationType } from '@prisma/client';

describe('NotificationsRepository (preferences)', () => {
  let repo: NotificationsRepository;
  const prisma = {
    notificationPreference: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  };

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        NotificationsRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    repo = mod.get(NotificationsRepository);
    jest.clearAllMocks();
  });

  it('findPreferences filtra por user + org', async () => {
    prisma.notificationPreference.findMany.mockResolvedValue([]);
    await repo.findPreferences('u1', 'o1');
    expect(prisma.notificationPreference.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', organizationId: 'o1' },
    });
  });

  it('upsertPreference usa a chave única (userId, org, type)', async () => {
    prisma.notificationPreference.upsert.mockResolvedValue({});
    await repo.upsertPreference('u1', 'o1', {
      type: NotificationType.NEW_MESSAGE,
      inApp: true, browserPush: false, sound: true,
      dndStart: '22:00', dndEnd: '08:00',
    });
    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { userId_organizationId_type: { userId: 'u1', organizationId: 'o1', type: NotificationType.NEW_MESSAGE } },
      create: { userId: 'u1', organizationId: 'o1', type: NotificationType.NEW_MESSAGE, inApp: true, browserPush: false, sound: true, dndStart: '22:00', dndEnd: '08:00' },
      update: { inApp: true, browserPush: false, sound: true, dndStart: '22:00', dndEnd: '08:00' },
    });
  });
});
