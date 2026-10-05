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

function makeBillingPrismaMock() {
  const store = new Map<string, any>();
  return {
    store,
    whatsappMessageBilling: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const k = where.uq_billing_channel_message;
        const key = `${k.channelId}|${k.externalMessageId}`;
        store.set(key, store.has(key) ? { ...store.get(key), ...update } : { ...create });
        return store.get(key);
      }),
    },
  } as any;
}

describe('ChannelUsageService.recordMessageBilling', () => {
  const SENT_AT = new Date('2026-10-02T14:00:00Z');
  const freeService = {
    externalMessageId: 'wamid.A',
    status: 'sent' as const,
    timestamp: SENT_AT,
    pricing: {
      billable: false,
      category: 'service',
      pricingModel: 'PMP',
      type: 'free_customer_service',
    },
  };

  it('grava uma linha por wamid e não duplica quando o status se repete', async () => {
    const prisma = makeBillingPrismaMock();
    const svc = new ChannelUsageService(prisma);

    await svc.recordMessageBilling('org1', 'chan1', freeService);
    await svc.recordMessageBilling('org1', 'chan1', {
      ...freeService,
      status: 'delivered',
      timestamp: new Date('2026-10-02T14:00:05Z'),
    });

    expect(prisma.store.size).toBe(1);
    expect(prisma.store.get('chan1|wamid.A')).toEqual({
      organizationId: 'org1',
      channelId: 'chan1',
      externalMessageId: 'wamid.A',
      category: 'service',
      pricingType: 'free_customer_service',
      billable: false,
      pricingModel: 'PMP',
      statusAt: SENT_AT, // fica com o 1º status que trouxe pricing
    });
  });

  it('ignora status sem pricing (delivered/read repetidos)', async () => {
    const prisma = makeBillingPrismaMock();
    const svc = new ChannelUsageService(prisma);

    await svc.recordMessageBilling('org1', 'chan1', {
      externalMessageId: 'wamid.A',
      status: 'read',
      timestamp: SENT_AT,
    });

    expect(prisma.whatsappMessageBilling.upsert).not.toHaveBeenCalled();
  });

  it('ignora status sem wamid', async () => {
    const prisma = makeBillingPrismaMock();
    const svc = new ChannelUsageService(prisma);

    await svc.recordMessageBilling('org1', 'chan1', {
      ...freeService,
      externalMessageId: '',
    });

    expect(prisma.whatsappMessageBilling.upsert).not.toHaveBeenCalled();
  });

  it('nunca volta uma linha cobrável para grátis', async () => {
    const prisma = makeBillingPrismaMock();
    const svc = new ChannelUsageService(prisma);

    await svc.recordMessageBilling('org1', 'chan1', {
      ...freeService,
      pricing: { billable: true, category: 'service', pricingModel: 'PMP', type: 'regular' },
    });
    await svc.recordMessageBilling('org1', 'chan1', {
      ...freeService,
      status: 'delivered',
      pricing: { billable: false, category: 'service' },
    });

    expect(prisma.store.get('chan1|wamid.A').billable).toBe(true);
  });

  it('promove para cobrável quando um status posterior marca billable', async () => {
    const prisma = makeBillingPrismaMock();
    const svc = new ChannelUsageService(prisma);

    await svc.recordMessageBilling('org1', 'chan1', freeService);
    await svc.recordMessageBilling('org1', 'chan1', {
      ...freeService,
      status: 'delivered',
      pricing: { billable: true, category: 'service', type: 'regular' },
    });

    const row = prisma.store.get('chan1|wamid.A');
    expect(row.billable).toBe(true);
    expect(row.pricingType).toBe('regular');
    expect(row.pricingModel).toBe('PMP'); // ausente no 2º payload: preservado
  });

  it('pricing vazio num status posterior não regride a categoria', async () => {
    const prisma = makeBillingPrismaMock();
    const svc = new ChannelUsageService(prisma);

    await svc.recordMessageBilling('org1', 'chan1', freeService);
    await svc.recordMessageBilling('org1', 'chan1', {
      ...freeService,
      status: 'read',
      pricing: {},
    });

    expect(prisma.store.get('chan1|wamid.A')).toMatchObject({
      category: 'service',
      pricingType: 'free_customer_service',
    });
  });
});

function makeReportPrismaMock(queryResults: any[][], overrides: Record<string, any> = {}) {
  const queue = [...queryResults];
  return {
    $queryRaw: jest.fn(async () => queue.shift() ?? []),
    whatsappWindowPricing: {
      findUnique: jest.fn(async () => ({
        currency: 'BRL',
        rates: { marketing: 0.35, service: 0.1 },
      })),
    },
    whatsappMessageBilling: {
      findFirst: jest.fn(async () => null),
    },
    ...overrides,
  } as any;
}

/** Texto e parâmetros de uma chamada `$queryRaw(Prisma.sql`...`)`. */
function rawCall(prisma: any, index: number): { sql: string; values: unknown[] } {
  const query = prisma.$queryRaw.mock.calls[index][0];
  return { sql: query.sql, values: query.values };
}

describe('ChannelUsageService.billing', () => {
  const FROM = new Date('2026-10-01T03:00:00Z');
  const TO = new Date('2026-10-03T03:00:00Z');

  it('agrega os baldes do banco no formato do contrato', async () => {
    const prisma = makeReportPrismaMock([
      [
        { bucketAt: new Date('2026-10-01T15:00:00Z'), category: 'marketing', pricingType: 'regular', billable: true, count: 4 },
        { bucketAt: new Date('2026-10-02T15:00:00Z'), category: 'service', pricingType: 'free_customer_service', billable: false, count: 77 },
      ],
    ]);
    const svc = new ChannelUsageService(prisma);

    const out = await svc.billing('org1', FROM, TO);

    expect(out.currency).toBe('BRL');
    expect(out.totals).toMatchObject({
      messages: 81,
      billable: 4,
      free: 77,
      estimatedCost: 1.4,
    });
    expect(out.daily.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02']);
    expect(out.projectedServiceCost).toBe(7.7);
    expect(out.firstBillableServiceDate).toBeNull();
  });

  it('usa defaults (BRL, tarifas zeradas) quando a org não cadastrou tarifa', async () => {
    const prisma = makeReportPrismaMock([[]], {
      whatsappWindowPricing: { findUnique: jest.fn(async () => null) },
    });
    const svc = new ChannelUsageService(prisma);

    const out = await svc.billing('org1', FROM, TO);

    expect(out.currency).toBe('BRL');
    expect(out.rates).toEqual({ marketing: 0, utility: 0, authentication: 0, service: 0 });
  });

  it('escopa a consulta pela organização e passa tudo como parâmetro', async () => {
    const prisma = makeReportPrismaMock([[]]);
    const svc = new ChannelUsageService(prisma);

    await svc.billing("org1'; DROP TABLE x; --", FROM, TO);

    const { sql, values } = rawCall(prisma, 0);
    expect(sql).toContain('organization_id = ');
    expect(sql).not.toContain('DROP TABLE');
    expect(values).toEqual([
      "org1'; DROP TABLE x; --",
      FROM.toISOString(),
      TO.toISOString(),
    ]);
  });

  it('firstBillableServiceDate olha o histórico todo da org, no dia de São Paulo', async () => {
    const findFirst = jest.fn(async () => ({
      statusAt: new Date('2026-10-07T01:30:00Z'),
    }));
    const prisma = makeReportPrismaMock([[]], {
      whatsappMessageBilling: { findFirst },
    });
    const svc = new ChannelUsageService(prisma);

    const out = await svc.billing('org1', FROM, TO);

    expect(out.firstBillableServiceDate).toBe('2026-10-06');
    expect(findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org1', category: 'service', billable: true },
      orderBy: { statusAt: 'asc' },
      select: { statusAt: true },
    });
  });
});

describe('ChannelUsageService.delivery', () => {
  const FROM = new Date('2026-10-01T03:00:00Z');
  const TO = new Date('2026-10-03T03:00:00Z');

  it('agrega status e motivos de falha no formato do contrato', async () => {
    const prisma = makeReportPrismaMock([
      [
        { bucketAt: new Date('2026-10-01T15:00:00Z'), status: 'READ', isTemplate: true, count: 6 },
        { bucketAt: new Date('2026-10-01T15:00:00Z'), status: 'DELIVERED', isTemplate: false, count: 2 },
        { bucketAt: new Date('2026-10-02T15:00:00Z'), status: 'FAILED', isTemplate: false, count: 2 },
      ],
      [
        { reason: '[131047] Re-engagement message', count: 1 },
        { reason: 'Janela de atendimento fechada — envie um template aprovado.', count: 1 },
      ],
    ]);
    const svc = new ChannelUsageService(prisma);

    const out = await svc.delivery('org1', FROM, TO);

    expect(out.totals).toEqual({
      outbound: 10,
      delivered: 8,
      read: 6,
      failed: 2,
      pending: 0,
      deliveryRate: 0.8,
      readRate: 0.75,
      failureRate: 0.2,
    });
    expect(out.daily).toEqual([
      { date: '2026-10-01', outbound: 8, delivered: 8, read: 6, failed: 0, templates: 6, freeForm: 2 },
      { date: '2026-10-02', outbound: 2, delivered: 0, read: 0, failed: 2, templates: 0, freeForm: 2 },
    ]);
    expect(out.failuresByReason).toEqual([
      { reason: 'Janela de 24h fechada', count: 2 },
    ]);
  });

  it('as duas consultas são escopadas pela org (conversa E canal) e parametrizadas', async () => {
    const prisma = makeReportPrismaMock([[], []]);
    const svc = new ChannelUsageService(prisma);

    await svc.delivery('org1', FROM, TO);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    for (const index of [0, 1]) {
      const { sql, values } = rawCall(prisma, index);
      expect(sql).toContain('c.organization_id = ');
      expect(sql).toContain('ch.organization_id = ');
      expect(sql).toContain(`ch.type = 'WHATSAPP_OFFICIAL'`);
      expect(sql).toContain(`m.direction = 'OUTBOUND'`);
      expect(sql).not.toContain('org1');
      expect(values).toEqual(
        expect.arrayContaining(['org1', FROM.toISOString(), TO.toISOString()]),
      );
    }
  });
});
