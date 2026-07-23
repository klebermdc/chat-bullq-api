import { ChannelUsageService } from './channel-usage.service';

function makePrismaMock() {
  const store = new Map<string, any>();
  return {
    store,
    whatsappWindow: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = `${where.uq_window_channel_conv.channelId}|${where.uq_window_channel_conv.metaConversationId}`;
        if (store.has(key)) {
          const cur = store.get(key);
          store.set(key, { ...cur, ...update });
          return store.get(key);
        }
        store.set(key, { ...create });
        return store.get(key);
      }),
    },
  } as any;
}

describe('ChannelUsageService.recordWindow', () => {
  it('cria janela na 1ª vez e não duplica no reenvio', async () => {
    const prisma = makePrismaMock();
    const svc = new ChannelUsageService(prisma);

    const status = {
      externalMessageId: 'wamid.A',
      status: 'sent' as const,
      timestamp: new Date('2026-07-20T10:00:00Z'),
      conversation: {
        id: 'CONV1',
        originType: 'marketing',
        expirationTimestamp: Math.floor(new Date('2026-07-21T10:00:00Z').getTime() / 1000),
      },
      pricing: { billable: true, category: 'marketing', pricingModel: 'CBP' },
    };

    await svc.recordWindow('org1', 'chan1', status);
    await svc.recordWindow('org1', 'chan1', status);

    expect(prisma.store.size).toBe(1);
    const row = prisma.store.get('chan1|CONV1');
    expect(row.category).toBe('marketing');
    expect(row.billable).toBe(true);
    expect(row.openedAt.toISOString()).toBe('2026-07-20T10:00:00.000Z');
  });

  it('ignora status sem conversation.id', async () => {
    const prisma = makePrismaMock();
    const svc = new ChannelUsageService(prisma);
    await svc.recordWindow('org1', 'chan1', {
      externalMessageId: 'wamid.B',
      status: 'delivered',
      timestamp: new Date(),
    });
    expect(prisma.whatsappWindow.upsert).not.toHaveBeenCalled();
  });

  it('não regride categoria para unknown num status posterior sem origin/pricing', async () => {
    const prisma = makePrismaMock();
    const svc = new ChannelUsageService(prisma);

    await svc.recordWindow('org1', 'chan1', {
      externalMessageId: 'wamid.A',
      status: 'sent',
      timestamp: new Date('2026-07-20T10:00:00Z'),
      conversation: { id: 'CONV1' },
      pricing: { billable: true, category: 'marketing', pricingModel: 'CBP' },
    });

    await svc.recordWindow('org1', 'chan1', {
      externalMessageId: 'wamid.A2',
      status: 'delivered',
      timestamp: new Date('2026-07-20T11:00:00Z'),
      conversation: { id: 'CONV1' },
    });

    expect(prisma.store.size).toBe(1);
    expect(prisma.store.get('chan1|CONV1').category).toBe('marketing');
  });

  it('preserva billable:false e não re-seta quando ausente depois', async () => {
    const prisma = makePrismaMock();
    const svc = new ChannelUsageService(prisma);

    await svc.recordWindow('org1', 'chan1', {
      externalMessageId: 'wamid.C',
      status: 'sent',
      timestamp: new Date('2026-07-20T10:00:00Z'),
      conversation: { id: 'CONV1' },
      pricing: { billable: false, category: 'service', pricingModel: 'CBP' },
    });

    expect(prisma.store.get('chan1|CONV1').billable).toBe(false);

    await svc.recordWindow('org1', 'chan1', {
      externalMessageId: 'wamid.C2',
      status: 'delivered',
      timestamp: new Date('2026-07-20T11:00:00Z'),
      conversation: { id: 'CONV1' },
    });

    expect(prisma.store.get('chan1|CONV1').billable).toBe(false);
  });
});
