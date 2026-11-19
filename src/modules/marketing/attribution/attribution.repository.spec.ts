import { AttributionRepository } from './attribution.repository';

jest.mock('../metrics/lead-count', () => ({ countLeads: jest.fn().mockResolvedValue(10) }));

/**
 * Lead/venda "de anúncio" = contato com TOQUE de anúncio: clique no
 * Click-to-WhatsApp (`contacts.ctwa_*`) ou formulário do site com UTM de
 * anúncio (`lead_submissions.attribution`). Período pelo toque, não pela
 * criação do contato.
 */
describe('AttributionRepository — toques CTWA + formulário do site', () => {
  const from = new Date('2026-11-01T00:00:00Z');
  const to = new Date('2026-11-07T23:59:59Z');

  function make(rows: any[] = []) {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue(rows) } as any;
    return { repo: new AttributionRepository(prisma), prisma };
  }

  /** Texto do SQL e valores parametrizados da chamada N. */
  function sqlOf(prisma: any, call = 0): { text: string; values: unknown[] } {
    const query = prisma.$queryRaw.mock.calls[call][0];
    return { text: query.sql as string, values: query.values as unknown[] };
  }

  it('touches junta CTWA e formulário do site, sem orgânico, apagado nem cliente oculto', async () => {
    const { repo, prisma } = make();
    await repo.leadsByAd('org-1', from, to);
    const { text, values } = sqlOf(prisma);

    expect(text).toContain('"ctwa_source_id"');
    expect(text).toContain('"lead_submissions"');
    expect(text).toContain(`'ofp_cmp'`);
    expect(text).toContain(`'ofp_cnt'`);
    expect(text).toContain('"ad_daily_stats"');
    // ID do anúncio no link (ofp_ad) vence o casamento por nome.
    expect(text).toContain(`'ofp_ad' ~ '^[0-9]+$'`);
    // Campanha errada no link: casa só pelo criativo quando o nome é único.
    expect(text).toContain('HAVING COUNT(DISTINCT a."ad_id") = 1');
    expect(text).toContain('"is_mystery_shopper" = false');
    expect(text).toContain('"deleted_at" IS NULL');
    expect(values).toEqual(expect.arrayContaining(['org-1', 'ad', 'organic', from, to]));
  });

  it('leadsByAd: período pelo toque, um lead por contato (último toque), com nomes da UTM', async () => {
    const { repo, prisma } = make([
      { ad_id: 'utm:camp|video40', ad_name: 'video40', campaign_name: 'camp', leads: BigInt(3) },
    ]);
    const rows = await repo.leadsByAd('org-1', from, to);
    const { text } = sqlOf(prisma);

    expect(text).toContain('DISTINCT ON (t."contact_id")');
    expect(text).not.toContain('"created_at" >=');
    expect(rows).toEqual([{ adId: 'utm:camp|video40', adName: 'video40', campaignName: 'camp', leads: 3 }]);
  });

  it('wonByAd: card GANHO no período pelo último toque do contato', async () => {
    const { repo, prisma } = make([
      { ad_id: '6896', ad_name: null, campaign_name: null, deals: BigInt(2), revenue: '7880.38' },
    ]);
    const rows = await repo.wonByAd('org-1', from, to);
    const { text } = sqlOf(prisma);

    expect(text).toContain(`"status" = 'WON'`);
    expect(text).toContain('CROSS JOIN LATERAL');
    expect(rows).toEqual([{ adId: '6896', adName: null, campaignName: null, deals: 2, revenue: 7880.38 }]);
  });

  it('cobertura: leads com anúncio = contatos com toque; não atribuído = Ganho sem nenhum toque', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ contacts: BigInt(4) }])
        .mockResolvedValueOnce([{ deals: BigInt(5), revenue: '1000.50' }]),
    } as any;
    const repo = new AttributionRepository(prisma);

    const totals = await repo.coverageTotals('org-1', from, to);

    expect(totals).toEqual({ leadsTotal: 10, leadsWithAdId: 4, unattributedDeals: 5, unattributedRevenue: 1000.5 });
    expect(sqlOf(prisma, 1).text).toContain('NOT EXISTS (SELECT 1 FROM touches t');
  });
});
