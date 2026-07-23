import { NotificationsController } from './notifications.controller';
import { NotificationType } from '@prisma/client';

describe('NotificationsController (preferences)', () => {
  let controller: NotificationsController;
  const service = { getPreferences: jest.fn(), updatePreferences: jest.fn() };

  beforeEach(() => {
    // Instantiated directly (not via Test.createTestingModule) because the
    // controller's class-level guards (JwtAuthGuard/OrgGuard/RolesGuard) pull
    // real Nest DI (Reflector, PrismaService, etc.) that isn't needed to prove
    // delegation and isn't worth mocking for a pure unit test.
    controller = new NotificationsController(service as any);
    jest.clearAllMocks();
  });

  it('GET preferences delega pro service com user+org', async () => {
    service.getPreferences.mockResolvedValue([]);
    await controller.getPreferences('u1', 'o1');
    expect(service.getPreferences).toHaveBeenCalledWith('u1', 'o1');
  });

  it('PATCH preferences delega o array pro service', async () => {
    service.updatePreferences.mockResolvedValue([]);
    const dto = { preferences: [{ type: NotificationType.NEW_MESSAGE, inApp: true, browserPush: false, sound: true, dndStart: null, dndEnd: null }] };
    await controller.updatePreferences('u1', 'o1', dto as any);
    expect(service.updatePreferences).toHaveBeenCalledWith('u1', 'o1', dto.preferences);
  });
});
