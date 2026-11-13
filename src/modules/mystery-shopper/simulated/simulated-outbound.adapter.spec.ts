import { SimulatedOutboundAdapter } from './simulated-outbound.adapter';

describe('SimulatedOutboundAdapter', () => {
  const channel: any = { id: 'ch1', organizationId: 'org1', type: 'WHATSAPP_OFFICIAL' };

  function build() {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    return { adapter: new SimulatedOutboundAdapter(queue as any), queue };
  }

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

  it('digitando e delete são no-op; mídia lança', async () => {
    const { adapter } = build();
    await expect(adapter.sendTypingIndicator(channel, 'x')).resolves.toBeUndefined();
    await expect(adapter.deleteMessage(channel, 'id')).resolves.toBeUndefined();
    await expect(adapter.getMediaUrl(channel, 'm')).rejects.toThrow('Mídia indisponível em contato simulado');
    await expect(adapter.downloadMedia(channel, 'm')).rejects.toThrow('Mídia indisponível em contato simulado');
  });
});
