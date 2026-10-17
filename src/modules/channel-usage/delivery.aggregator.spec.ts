import { aggregateDelivery, DeliveryBucketRow } from './delivery.aggregator';

const DAYS = ['2026-10-01', '2026-10-02'];

function row(
  at: string,
  status: string,
  isTemplate: boolean,
  count: number,
): DeliveryBucketRow {
  return { bucketAt: new Date(at), status, isTemplate, count };
}

describe('aggregateDelivery', () => {
  it('sem mensagens: zeros, taxas 0 e todos os dias presentes', () => {
    const out = aggregateDelivery({ rows: [], dayKeys: DAYS, failures: [] });
    expect(out.totals).toEqual({
      outbound: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      pending: 0,
      deliveryRate: 0,
      readRate: 0,
      failureRate: 0,
    });
    expect(out.daily).toEqual(
      DAYS.map((date) => ({
        date,
        outbound: 0,
        delivered: 0,
        read: 0,
        failed: 0,
        templates: 0,
        freeForm: 0,
      })),
    );
    expect(out.failuresByReason).toEqual([]);
  });

  it('entregue conta DELIVERED e READ; pendente é o resto', () => {
    const out = aggregateDelivery({
      rows: [
        row('2026-10-01T15:00:00Z', 'READ', false, 40),
        row('2026-10-01T15:00:00Z', 'DELIVERED', false, 30),
        row('2026-10-01T15:00:00Z', 'SENT', false, 15),
        row('2026-10-01T15:00:00Z', 'QUEUED', false, 5),
        row('2026-10-01T15:00:00Z', 'FAILED', false, 10),
      ],
      dayKeys: DAYS,
      failures: [],
    });
    expect(out.totals).toEqual({
      outbound: 100,
      delivered: 70,
      read: 40,
      failed: 10,
      pending: 20,
      deliveryRate: 0.7,
      readRate: 0.5714,
      failureRate: 0.1,
    });
  });

  it('readRate é 0 quando nada foi entregue', () => {
    const out = aggregateDelivery({
      rows: [row('2026-10-01T15:00:00Z', 'FAILED', false, 3)],
      dayKeys: DAYS,
      failures: [],
    });
    expect(out.totals.readRate).toBe(0);
    expect(out.totals.failureRate).toBe(1);
  });

  it('diário separa template de texto livre, no dia de São Paulo', () => {
    const out = aggregateDelivery({
      rows: [
        row('2026-10-02T02:00:00Z', 'READ', true, 2), // 23h do dia 01
        row('2026-10-02T02:00:00Z', 'FAILED', false, 1),
        row('2026-10-02T03:00:00Z', 'DELIVERED', false, 4), // 00h do dia 02
      ],
      dayKeys: DAYS,
      failures: [],
    });
    expect(out.daily).toEqual([
      { date: '2026-10-01', outbound: 3, delivered: 2, read: 2, failed: 1, templates: 2, freeForm: 1 },
      { date: '2026-10-02', outbound: 4, delivered: 4, read: 0, failed: 0, templates: 0, freeForm: 4 },
    ]);
  });

  it('normaliza os motivos de falha', () => {
    const out = aggregateDelivery({
      rows: [row('2026-10-01T15:00:00Z', 'FAILED', false, 7)],
      dayKeys: DAYS,
      failures: [
        { reason: '[131047] Re-engagement message', count: 5 },
        { reason: null, count: 2 },
      ],
    });
    expect(out.failuresByReason).toEqual([
      { reason: 'Janela de 24h fechada', count: 5 },
      { reason: 'Sem motivo informado', count: 2 },
    ]);
  });
});
