import { NotFoundException } from '@nestjs/common';
import { MysteryShopperController } from './mystery-shopper.controller';

describe('MysteryShopperController', () => {
  const service = { listVisits: jest.fn().mockResolvedValue([]), kpis: jest.fn().mockResolvedValue({ month: '2026-11' }) };
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

  const personas = { generate: jest.fn().mockResolvedValue({ persona: 'Nome: Carla, viaja em julho.' }) };

  test('/access responde false sem erro para quem não pode ver', async () => {
    const access = { isAllowed: jest.fn().mockResolvedValue(false), assertViewer: jest.fn() };
    const controller = new MysteryShopperController(service as never, access as never, simulator as never, bot as never, personas as never);
    expect(await controller.access('org', 'dono@x.com')).toEqual({ allowed: false });
  });

  test('qualquer outra rota = 404 para quem não pode ver', async () => {
    const access = { assertViewer: jest.fn().mockRejectedValue(new NotFoundException()) };
    const controller = new MysteryShopperController(service as never, access as never, simulator as never, bot as never, personas as never);
    await expect(controller.listVisits('org', 'dono@x.com')).rejects.toBeInstanceOf(NotFoundException);
    expect(service.listVisits).not.toHaveBeenCalled();
  });

  test('/kpis: 404 para quem não é viewer; viewer recebe o mês pedido', async () => {
    const denied = { assertViewer: jest.fn().mockRejectedValue(new NotFoundException()) };
    const blocked = new MysteryShopperController(service as never, denied as never, simulator as never, bot as never, personas as never);
    await expect(blocked.kpis('org', 'dono@x.com', '2026-11')).rejects.toBeInstanceOf(NotFoundException);
    expect(service.kpis).not.toHaveBeenCalled();

    const allowed = { assertViewer: jest.fn().mockResolvedValue(undefined) };
    const controller = new MysteryShopperController(service as never, allowed as never, simulator as never, bot as never, personas as never);
    await expect(controller.kpis('org', 'v@x.com', '2026-11')).resolves.toEqual({ month: '2026-11' });
    expect(service.kpis).toHaveBeenCalledWith('org', '2026-11');
  });

  test('rotas do simulador: 404 para quem não é viewer, sem tocar no serviço', async () => {
    const access = { assertViewer: jest.fn().mockRejectedValue(new NotFoundException()) };
    const controller = new MysteryShopperController(service as never, access as never, simulator as never, bot as never, personas as never);
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
    const controller = new MysteryShopperController(service as never, access as never, simulator as never, bot as never, personas as never);
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
    const controller = new MysteryShopperController(service as never, access as never, simulator as never, bot as never, personas as never);
    await expect(controller.startBot('org', 'v@x.com', 'n1', { persona: 'Maria quer Orlando' })).resolves.toEqual(BOT);
    await expect(controller.stopBot('org', 'v@x.com', 'n1')).resolves.toMatchObject({ status: 'STOPPED' });
    expect(access.assertViewer).toHaveBeenCalledTimes(2);
    expect(bot.start).toHaveBeenCalledWith('org', 'n1', 'Maria quer Orlando');
    expect(bot.stop).toHaveBeenCalledWith('org', 'n1');
  });

  test('gerar persona: 404 para quem não é viewer, sem chamar a IA', async () => {
    const access = { assertViewer: jest.fn().mockRejectedValue(new NotFoundException()) };
    const controller = new MysteryShopperController(service as never, access as never, simulator as never, bot as never, personas as never);
    await expect(controller.generatePersona('org', 'x@x.com', { brief: 'casal em julho' })).rejects.toBeInstanceOf(NotFoundException);
    expect(personas.generate).not.toHaveBeenCalled();
  });

  test('gerar persona: viewer recebe a persona da org dele', async () => {
    const access = { assertViewer: jest.fn().mockResolvedValue(undefined) };
    const controller = new MysteryShopperController(service as never, access as never, simulator as never, bot as never, personas as never);
    await expect(controller.generatePersona('org', 'v@x.com', { brief: 'casal em julho' })).resolves.toEqual({ persona: 'Nome: Carla, viaja em julho.' });
    expect(access.assertViewer).toHaveBeenCalledWith('org', 'v@x.com');
    expect(personas.generate).toHaveBeenCalledWith('org', 'casal em julho');
  });
});
