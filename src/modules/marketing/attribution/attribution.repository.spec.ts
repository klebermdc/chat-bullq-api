import { AttributionRepository } from './attribution.repository';

/**
 * Lead "de anúncio" no período = quem CLICOU no anúncio no período
 * (`ctwaClidAt`), não quem foi criado no período. Cliente antigo que volta
 * por um anúncio conta para o anúncio; contato novo que clicou meses atrás não.
 */
describe('AttributionRepository — período pelo clique', () => {
  const from = new Date('2026-11-01T00:00:00Z');
  const to = new Date('2026-11-07T23:59:59Z');

  function make() {
    const prisma = {
      contact: {
        groupBy: jest.fn().mockResolvedValue([{ ctwaSourceId: 'ad-1', _count: { _all: 3 } }]),
        count: jest.fn().mockResolvedValue(0),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ deals: BigInt(0), revenue: null }]),
    } as any;
    return { repo: new AttributionRepository(prisma), prisma };
  }

  it('leadsByAd filtra por ctwaClidAt', async () => {
    const { repo, prisma } = make();
    expect(await repo.leadsByAd('org-1', from, to)).toEqual([{ adId: 'ad-1', leads: 3 }]);
    const where = prisma.contact.groupBy.mock.calls[0][0].where;
    expect(where.ctwaClidAt).toEqual({ gte: from, lte: to });
    expect(where.createdAt).toBeUndefined();
  });

  it('cobertura: leads com anúncio também pelo clique', async () => {
    const { repo, prisma } = make();
    await repo.coverageTotals('org-1', from, to);
    const withAd = prisma.contact.count.mock.calls[1][0].where;
    expect(withAd.ctwaClidAt).toEqual({ gte: from, lte: to });
    expect(withAd.createdAt).toBeUndefined();
  });
});
