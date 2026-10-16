import { ContractReportsService } from './contract-reports.service';
import type { ContractsRepository } from './contracts.repository';

function make(rows: unknown[]) {
  const findAll = jest.fn().mockResolvedValue(rows);
  const repo = { findAll } as unknown as ContractsRepository;
  return { service: new ContractReportsService(repo), findAll };
}

describe('ContractReportsService.billing', () => {
  it('soma separado por moeda e conta valores ilegíveis', async () => {
    const { service } = make([
      { id: '1', amount: '2.190,00', acceptedAt: null, paid: false, paymentReceiptKey: null, invoiceIssued: false },
      { id: '2', amount: '$ 150.00', acceptedAt: null, paid: false, paymentReceiptKey: null, invoiceIssued: true },
      { id: '3', amount: 'a combinar', acceptedAt: null, paid: false, paymentReceiptKey: null, invoiceIssued: false },
    ]);
    const r = await service.billing('org1', { year: 2026, month: 2 });
    expect(r.totals).toEqual({ BRL: 2190, USD: 150, unparsed: 1 });
    expect(r.items.map((i) => i.status)).toEqual(['pending', 'invoiced', 'pending']);
  });

  it('filtra pela org e pelo mês', async () => {
    const { service, findAll } = make([]);
    await service.billing('org1', { year: 2026, month: 2, guide: 'Rafael' });
    const where = findAll.mock.calls[0][0];
    expect(where.organizationId).toBe('org1');
    expect(where.createdAt.gte).toEqual(new Date('2026-02-01T00:00:00Z'));
    expect(where.guideName).toEqual({ equals: 'Rafael', mode: 'insensitive' });
  });
});

describe('ContractReportsService.reminders', () => {
  it('usa as datas lidas do contrato (estruturadas ou legado)', async () => {
    const { service } = make([
      {
        id: 'a', fullName: 'A', phone: '1', guideName: 'Kleber', disneyGuest: true, purchased: false,
        parkDates: [{ parkId: 'epcot', date: '2026-12-10' }], requestedDates: '', createdAt: new Date('2026-10-01'),
      },
    ]);
    const out = await service.multipassReminders('org1', undefined, '2026-12-01');
    expect(out[0]).toMatchObject({ id: 'a', buyDate: '2026-12-03', daysUntilBuy: 2 });
  });
});

describe('ContractReportsService.calendar', () => {
  it('gera uma linha por data de parque', async () => {
    const { service } = make([
      {
        id: 'a', fullName: 'A', phone: '1', guideName: 'Kleber', disneyGuest: false, purchased: false,
        parkDates: [{ parkId: 'epcot', date: '2026-12-10' }, { parkId: 'epcot', date: '2026-12-11' }],
        requestedDates: '', createdAt: new Date('2026-10-01'),
      },
    ]);
    const out = await service.calendar('org1', 'Kleber');
    expect(out.map((e) => e.date)).toEqual(['2026-12-10', '2026-12-11']);
    expect(out[0]).toMatchObject({ contractId: 'a', parkId: 'epcot' });
  });
});
