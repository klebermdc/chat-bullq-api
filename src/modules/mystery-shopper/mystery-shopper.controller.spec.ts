import { NotFoundException } from '@nestjs/common';
import { MysteryShopperController } from './mystery-shopper.controller';

describe('MysteryShopperController', () => {
  const service = { listVisits: jest.fn().mockResolvedValue([]) };
  const simulator = {
    listChannels: jest.fn().mockResolvedValue([]),
    createNumber: jest.fn().mockResolvedValue({ id: 'n1' }),
    sendMessage: jest.fn().mockResolvedValue({ queued: true }),
    getConversation: jest.fn().mockResolvedValue({}),
  };

  test('/access responde false sem erro para quem não pode ver', async () => {
    const access = { isAllowed: jest.fn().mockResolvedValue(false), assertViewer: jest.fn() };
    const controller = new MysteryShopperController(service as never, access as never, simulator as never);
    expect(await controller.access('org', 'dono@x.com')).toEqual({ allowed: false });
  });

  test('qualquer outra rota = 404 para quem não pode ver', async () => {
    const access = { assertViewer: jest.fn().mockRejectedValue(new NotFoundException()) };
    const controller = new MysteryShopperController(service as never, access as never, simulator as never);
    await expect(controller.listVisits('org', 'dono@x.com')).rejects.toBeInstanceOf(NotFoundException);
    expect(service.listVisits).not.toHaveBeenCalled();
  });

  test('rotas do simulador: 404 para quem não é viewer, sem tocar no serviço', async () => {
    const access = { assertViewer: jest.fn().mockRejectedValue(new NotFoundException()) };
    const controller = new MysteryShopperController(service as never, access as never, simulator as never);
    await expect(controller.listChannels('org', 'x@x.com')).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.addSimulatedNumber('org', 'x@x.com', 'u1', { label: 'a', channelId: 'c' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.sendSimulated('org', 'x@x.com', 'n1', { text: 'oi' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.getSimulator('org', 'x@x.com', 'n1')).rejects.toBeInstanceOf(NotFoundException);
    for (const fn of Object.values(simulator)) expect(fn).not.toHaveBeenCalled();
  });

  test('rotas do simulador delegam ao serviço para o viewer', async () => {
    const access = { assertViewer: jest.fn().mockResolvedValue(undefined) };
    const controller = new MysteryShopperController(service as never, access as never, simulator as never);
    await controller.listChannels('org', 'v@x.com');
    await controller.addSimulatedNumber('org', 'v@x.com', 'u1', { label: 'a', profileName: 'Ana', channelId: 'c' });
    await controller.sendSimulated('org', 'v@x.com', 'n1', { text: 'oi' });
    await controller.getSimulator('org', 'v@x.com', 'n1');
    expect(access.assertViewer).toHaveBeenCalledTimes(4);
    expect(simulator.createNumber).toHaveBeenCalledWith('org', { label: 'a', profileName: 'Ana', channelId: 'c' }, 'u1');
    expect(simulator.sendMessage).toHaveBeenCalledWith('org', 'n1', 'oi');
    expect(simulator.getConversation).toHaveBeenCalledWith('org', 'n1');
  });
});
