import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';
import { PrismaService } from '../../database/prisma.service';
import { getQueueToken } from '@nestjs/bullmq';
import { NotificationType } from '@prisma/client';

describe('NotificationsService (preferences)', () => {
  let service: NotificationsService;
  const repo = { findPreferences: jest.fn(), upsertPreference: jest.fn() };

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: NotificationsRepository, useValue: repo },
        { provide: PrismaService, useValue: {} },
        { provide: getQueueToken('notifications'), useValue: { add: jest.fn() } },
      ],
    }).compile();
    service = mod.get(NotificationsService);
    jest.clearAllMocks();
  });

  it('getPreferences retorna o que o repo devolve', async () => {
    repo.findPreferences.mockResolvedValue([{ type: 'NEW_MESSAGE' }]);
    const out = await service.getPreferences('u1', 'o1');
    expect(out).toEqual([{ type: 'NEW_MESSAGE' }]);
  });

  it('updatePreferences faz upsert de cada item', async () => {
    repo.upsertPreference.mockResolvedValue({});
    repo.findPreferences.mockResolvedValue([]);
    await service.updatePreferences('u1', 'o1', [
      { type: NotificationType.NEW_MESSAGE, inApp: true, browserPush: true, sound: false, dndStart: null, dndEnd: null },
    ]);
    expect(repo.upsertPreference).toHaveBeenCalledTimes(1);
    expect(repo.upsertPreference).toHaveBeenCalledWith('u1', 'o1', expect.objectContaining({ sound: false }));
  });
});
