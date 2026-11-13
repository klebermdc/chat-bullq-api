import { SimulatedOutboundAdapter } from './simulated-outbound.adapter';

describe('SimulatedOutboundAdapter', () => {
  const channel: any = { id: 'ch1', organizationId: 'org1', type: 'WHATSAPP_OFFICIAL' };

  function build(run: unknown = null, existingJob: unknown = undefined) {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const botQueue = { add: jest.fn().mockResolvedValue(undefined), getJob: jest.fn().mockResolvedValue(existingJob) };
    const prisma = { mysteryShopperBotRun: { findFirst: jest.fn().mockResolvedValue(run) } };
    return { adapter: new SimulatedOutboundAdapter(queue as any, botQueue as any, prisma as any), queue, botQueue, prisma };
  }
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const text = { type: 'TEXT', content: { text: 'oi' } } as any;

  it('devolve id sim.out. e marca a resposta como simulada', async () => {
    const { adapter } = build();
    const r = await adapter.sendMessage(channel, '5511912345678', { type: 'TEXT', content: { text: 'oi' } } as any);
    expect(r.externalId).toMatch(/^sim\.out\./);
    expect(r.providerResponse).toEqual({ simulated: true });
  });

  it('enfileira delivered (+2s) e read (+6s) na fila de entrada', async () => {
    const { adapter, queue } = build();
    const r = await adapter.sendMessage(channel, '5511912345678', { type: 'TEXT', content: { text: 'oi' } } as any);

    expect(queue.add).toHaveBeenCalledTimes(2);
    const [first, second] = queue.add.mock.calls;
    expect(first[0]).toBe('process-status');
    expect(first[1]).toEqual({
      channelId: 'ch1',
      organizationId: 'org1',
      status: { externalMessageId: r.externalId, status: 'delivered', timestamp: expect.any(Date) },
    });
    expect(first[2]).toEqual(expect.objectContaining({ delay: 2000 }));
    expect(second[1].status.status).toBe('read');
    expect(second[2]).toEqual(expect.objectContaining({ delay: 6000 }));
  });

  it('timestamp dos status é o instante em que o status acontece (envio + atraso)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
    try {
      const { adapter, queue } = build();
      await adapter.sendMessage(channel, '5525912345678', { type: 'TEXT', content: { text: 'oi' } } as any);
      const [first, second] = queue.add.mock.calls;
      expect(first[1].status.timestamp).toEqual(new Date('2026-01-01T12:00:02.000Z'));
      expect(second[1].status.timestamp).toEqual(new Date('2026-01-01T12:00:06.000Z'));
    } finally {
      jest.useRealTimers();
    }
  });

  it('digitando e delete são no-op; mídia lança', async () => {
    const { adapter } = build();
    await expect(adapter.sendTypingIndicator(channel, 'x')).resolves.toBeUndefined();
    await expect(adapter.deleteMessage(channel, 'id')).resolves.toBeUndefined();
    await expect(adapter.getMediaUrl(channel, 'm')).rejects.toThrow('Mídia indisponível em contato simulado');
    await expect(adapter.downloadMedia(channel, 'm')).rejects.toThrow('Mídia indisponível em contato simulado');
  });

  describe('acordar o robô do cliente oculto', () => {
    it('com execução ativa agenda bot-turn com jobId por execução e espera de 40–90 s', async () => {
      const { adapter, botQueue, prisma } = build({ id: 'r1' });
      await adapter.sendMessage(channel, '5525912345678', text);
      await flush();
      expect(prisma.mysteryShopperBotRun.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org1',
            status: { in: ['ACTIVE', 'CLOSING'] },
            number: expect.objectContaining({ isSimulated: true, channelId: 'ch1', contact: { phone: '5525912345678' } }),
          }),
        }),
      );
      expect(botQueue.add).toHaveBeenCalledTimes(1);
      const [name, data, opts] = botQueue.add.mock.calls[0];
      expect(name).toBe('bot-turn');
      expect(data).toEqual({ runId: 'r1' });
      expect(opts.jobId).toBe('bot-turn-r1');
      expect(opts.delay).toBeGreaterThanOrEqual(40_000);
      expect(opts.delay).toBeLessThanOrEqual(90_000);
      expect(opts).toEqual(expect.objectContaining({ removeOnComplete: true, removeOnFail: true }));
    });

    it('debounce: job anterior pendente é removido antes de recriar', async () => {
      const order: string[] = [];
      const job = { remove: jest.fn().mockImplementation(async () => void order.push('remove')) };
      const { adapter, botQueue } = build({ id: 'r1' }, job);
      botQueue.add.mockImplementation(async () => void order.push('add'));
      await adapter.sendMessage(channel, '5525912345678', text);
      await flush();
      expect(botQueue.getJob).toHaveBeenCalledWith('bot-turn-r1');
      expect(order).toEqual(['remove', 'add']);
    });

    it('job que não pode ser removido (em execução) não impede o envio nem o agendamento', async () => {
      const job = { remove: jest.fn().mockRejectedValue(new Error('locked')) };
      const { adapter, botQueue } = build({ id: 'r1' }, job);
      await expect(adapter.sendMessage(channel, '5525912345678', text)).resolves.toMatchObject({ externalId: expect.stringMatching(/^sim\.out\./) });
      await flush();
      expect(botQueue.add).toHaveBeenCalled();
    });

    it('sem execução ativa não agenda', async () => {
      const { adapter, botQueue } = build(null);
      await adapter.sendMessage(channel, '5525912345678', text);
      await flush();
      expect(botQueue.add).not.toHaveBeenCalled();
      expect(botQueue.getJob).not.toHaveBeenCalled();
    });

    it('erro ao agendar nunca quebra o envio', async () => {
      const { adapter, botQueue, queue } = build({ id: 'r1' });
      botQueue.add.mockRejectedValue(new Error('redis fora'));
      const r = await adapter.sendMessage(channel, '5525912345678', text);
      await flush();
      expect(r.externalId).toMatch(/^sim\.out\./);
      expect(queue.add).toHaveBeenCalledTimes(2);
    });

    it('erro na consulta ao banco nunca quebra o envio', async () => {
      const { adapter, prisma } = build();
      prisma.mysteryShopperBotRun.findFirst.mockRejectedValue(new Error('db fora'));
      await expect(adapter.sendMessage(channel, '5525912345678', text)).resolves.toMatchObject({ providerResponse: { simulated: true } });
      await flush();
    });
  });
});
