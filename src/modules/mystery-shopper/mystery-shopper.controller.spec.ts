import { NotFoundException } from '@nestjs/common';
import { MysteryShopperController } from './mystery-shopper.controller';

describe('MysteryShopperController', () => {
  const service = { listVisits: jest.fn().mockResolvedValue([]) };

  test('/access responde false sem erro para quem não pode ver', async () => {
    const access = { isAllowed: jest.fn().mockResolvedValue(false), assertViewer: jest.fn() };
    const controller = new MysteryShopperController(service as never, access as never);
    expect(await controller.access('org', 'dono@x.com')).toEqual({ allowed: false });
  });

  test('qualquer outra rota = 404 para quem não pode ver', async () => {
    const access = { assertViewer: jest.fn().mockRejectedValue(new NotFoundException()) };
    const controller = new MysteryShopperController(service as never, access as never);
    await expect(controller.listVisits('org', 'dono@x.com')).rejects.toBeInstanceOf(NotFoundException);
    expect(service.listVisits).not.toHaveBeenCalled();
  });
});
