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
  const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const prisma = {
    ofpSalesOrder: { upsert, deleteMany },
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

  it('reconciles deletions: removes rows whose externalId is not in the fetched set', async () => {
    await service.sync();
    expect(deleteMany).toHaveBeenCalledWith({ where: { externalId: { notIn: ['o1'] } } });
  });

  it('does NOT delete when the fetch returns zero orders (guard against wipe)', async () => {
    ofp.getOrders.mockResolvedValueOnce([]);
    await service.sync();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('retries a transient upsert failure (pool timeout) and still completes', async () => {
    upsert
      .mockRejectedValueOnce(
        new Error('Timed out fetching a new connection from the connection pool'),
      )
      .mockResolvedValue({});
    const res = await service.sync();
    expect(res.count).toBe(1);
    // one failed attempt + one successful retry for the single order
    expect(upsert).toHaveBeenCalledTimes(2);
    // state recorded without error
    expect(stateUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ lastError: null }) }),
    );
  });
});
