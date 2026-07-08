import { InactivityReportService } from './inactivity-report.service';

function makeDeps() {
  const repo = {
    countByBand: jest.fn(async () => [
      { band: 0, count: 3 },
      { band: 2, count: 1 },
    ]),
    listInactive: jest.fn(async () => [
      {
        id: 'c1',
        inactivityBand: 2,
        lastOutboundAt: new Date(Date.now() - 20 * 86400000),
        lastInboundAt: null,
        contact: { id: 'ct1', name: 'Alice' },
        channel: { id: 'ch1', name: 'WA' },
        assignedTo: null,
        scheduledMessages: [],
      },
    ]),
  };
  return { service: new InactivityReportService(repo as any), repo };
}

describe('InactivityReportService', () => {
  it('agrega faixas e calcula daysStale', async () => {
    const { service } = makeDeps();
    const r = await service.report({
      organizationId: 'org1',
      page: 1,
      pageSize: 20,
    });
    expect(r.byBand).toEqual([
      { band: 0, count: 3 },
      { band: 2, count: 1 },
    ]);
    expect(r.items[0].daysStale).toBeGreaterThanOrEqual(19);
    expect(r.items[0].hasPendingSchedule).toBe(false);
  });

  it('csv tem header e uma linha por item', async () => {
    const { service } = makeDeps();
    const csv = await service.csv({ organizationId: 'org1' });
    expect(csv.split('\n')[0]).toContain('conversationId,band,daysStale');
    expect(csv.split('\n')).toHaveLength(2);
  });
});
