import { NotFoundException } from '@nestjs/common';
import { MysteryShopperController } from './mystery-shopper.controller';

describe('MysteryShopperController', () => {
  const service = { listVisits: jest.fn().mockResolvedValue([]) };
  const simulator = {
    listChannels: jest.fn().mockResolvedValue([]),
    createNumber: jest.fn().mockResolvedValue({ id: 'n1' }),
    sendMessage: jest.fn().mockResolvedValue({ queued: true }),
    getConversation: jest.fn().mockResolvedValue({ conversationId: 'c1', messages: [] }),
  };
  const BOT = { status: 'ACTIVE', persona: 'Maria quer Orlando', clientMessages: 1, lastError: null };
  const bot = {
    start: jest.fn().mockResolvedValue(BOT),
    stop: jest.fn().mockResolvedValue({ ...BOT, status: 'STOPPED' }),
    getState: jest.fn().mockResolvedValue(BOT),
  };

  test('/access responde false sem erro para quem não pode ver', async () => {
    const access = { isAllowed: jest.fn().mockResolvedValue(false), assertViewer: jest.fn() };
    const controller = new MysteryShopperController(service as never, access as never, simulator as never, bot as never);
    expect(await controller.access('org', 'dono@x.com')).toEqual({ allowed: false });
  });

  test('qualquer outra rota = 404 para quem não pode ver', async () => {
    const access = { assertViewer: jest.fn().mockRejectedValue(new NotFoundException()) };
    const controller = new MysteryShopperController(service as never, access as never, simulator as never, bot as never);
    await expect(controller.listVisits('org', 'dono@x.com')).rejects.toBeInstanceOf(NotFoundException);
    expect(service.listVisits).not.toHaveBeenCalled();
  });

  test('rotas do simulador: 404 para quem não é viewer, sem tocar no serviço', async () => {
    const access = { assertViewer: jest.fn().mockRejectedValue(new NotFoundException()) };
    const controller = new MysteryShopperController(service as never, access as never, simulator as never, bot as never);
    await expect(controller.listChannels('org', 'x@x.com')).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.addSimulatedNumber('org', 'x@x.com', 'u1', { label: 'a', channelId: 'c' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.sendSimulated('org', 'x@x.com', 'n1', { text: 'oi' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.getSimulator('org', 'x@x.com', 'n1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.startBot('org', 'x@x.com', 'n1', { persona: 'Maria quer Orlando' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.stopBot('org', 'x@x.com', 'n1')).rejects.toBeInstanceOf(NotFoundException);
    for (const fn of [...Object.values(simulator), ...Object.values(bot)]) expect(fn).not.toHaveBeenCalled();
  });

  test('rotas do simulador delegam ao serviço para o viewer', async () => {
    const access = { assertViewer: jest.fn().mockResolvedValue(undefined) };
    const controller = new MysteryShopperController(service as never, access as never, simulator as never, bot as never);
    await controller.listChannels('org', 'v@x.com');
    await controller.addSimulatedNumber('org', 'v@x.com', 'u1', { label: 'a', profileName: 'Ana', channelId: 'c' });
    await controller.sendSimulated('org', 'v@x.com', 'n1', { text: 'oi' });
    const view = await controller.getSimulator('org', 'v@x.com', 'n1');
    expect(access.assertViewer).toHaveBeenCalledTimes(4);
    expect(view).toEqual({ conversationId: 'c1', messages: [], bot: BOT });
    expect(bot.getState).toHaveBeenCalledWith('org', 'n1');
    expect(simulator.createNumber).toHaveBeenCalledWith('org', { label: 'a', profileName: 'Ana', channelId: 'c' }, 'u1');
    expect(simulator.sendMessage).toHaveBeenCalledWith('org', 'n1', 'oi');
    expect(simulator.getConversation).toHaveBeenCalledWith('org', 'n1');
  });

  test('rotas do robô delegam ao serviço para o viewer', async () => {
    const access = { assertViewer: jest.fn().mockResolvedValue(undefined) };
    const controller = new MysteryShopperController(service as never, access as never, simulator as never, bot as never);
    await expect(controller.startBot('org', 'v@x.com', 'n1', { persona: 'Maria quer Orlando' })).resolves.toEqual(BOT);
    await expect(controller.stopBot('org', 'v@x.com', 'n1')).resolves.toMatchObject({ status: 'STOPPED' });
    expect(access.assertViewer).toHaveBeenCalledTimes(2);
    expect(bot.start).toHaveBeenCalledWith('org', 'n1', 'Maria quer Orlando');
    expect(bot.stop).toHaveBeenCalledWith('org', 'n1');
  });
});
