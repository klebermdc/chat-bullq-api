import { Test } from '@nestjs/testing';
import { OfpSyncService } from './ofp-sync.service';
import { OfpReportService } from './ofp-report.service';
import { PrismaService } from '../../database/prisma.service';

describe('OfpSyncService', () => {
  const orders = [
    { id: 'o1', pedido: '1', cliente: 'A', vendedor: 'Pedro', venda: 100, comissao_vendedor: 10, data: '07/07/2026', status: 'Pendente', created_at: '2026-07-07T00:00:00Z', updated_at: null },
  ];
  const upsert = jest.fn().mockResolvedValue({});
  const stateUpsert = jest.fn().mockResolvedValue({});
  const prisma = {
    ofpSalesOrder: { upsert },
    ofpSyncState: { upsert: stateUpsert },
  } as any;
  const ofp = { getOrders: jest.fn().mockResolvedValue(orders) } as any;

  let service: OfpSyncService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        OfpSyncService,
        { provide: OfpReportService, useValue: ofp },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(OfpSyncService);
  });

  it('upserts each order by externalId and returns count', async () => {
    const res = await service.sync();
    expect(res.count).toBe(1);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { externalId: 'o1' } }));
  });

  it('parses DD/MM/YYYY into data Date and keeps dataRaw', async () => {
    await service.sync();
    const arg = upsert.mock.calls[0][0];
    expect(arg.create.dataRaw).toBe('07/07/2026');
    expect(arg.create.data instanceof Date).toBe(true);
    expect(arg.create.externalId).toBe('o1');
  });

  it('records sync state with count', async () => {
    await service.sync();
    expect(stateUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }));
  });

  it('is idempotent: running twice resolves with count again', async () => {
    await service.sync();
    await expect(service.sync()).resolves.toEqual(expect.objectContaining({ count: 1 }));
  });
});
