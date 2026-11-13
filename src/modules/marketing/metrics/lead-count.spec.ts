import { countLeads, NOT_IMPORTED_CONTACT } from './lead-count';
import { MarketingRepository } from './marketing.repository';

/**
 * Lead = contato que CHEGOU no período. Contato criado por script de
 * importação (carteira Umbler: `metadata.origem` = 'umbler' / 'umbler_caixa')
 * nasce com `created_at` do dia da importação e inflava o mês — 07/11/2026
 * mostrou 8.133 "leads" num dia, 8.085 deles da carteira.
 */
describe('contagem de leads ignora contatos importados', () => {
  const from = new Date('2026-11-01T03:00:00Z');
  const to = new Date('2026-12-01T02:59:59Z');

  function sqlText(call: any[]): string {
    return call[0].strings.join('?');
  }

  it('countLeads exclui quem tem metadata.origem', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ leads: BigInt(411) }]) } as any;

    expect(await countLeads(prisma, 'org-1', from, to)).toBe(411);

    const sql = sqlText(prisma.$queryRaw.mock.calls[0]);
    expect(sql).toContain(`"metadata"->>'origem' IS NULL`);
    expect(sql).toContain('"deleted_at" IS NULL');
    expect(prisma.$queryRaw.mock.calls[0][0].values).toEqual(['org-1', from, to]);
  });

  it('countLeads devolve 0 sem linha', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) } as any;
    expect(await countLeads(prisma, 'org-1', from, to)).toBe(0);
  });

  it('série diária do gráfico usa a mesma regra', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) } as any;
    await new MarketingRepository(prisma).dailyLeads('org-1', from, to);

    expect(sqlText(prisma.$queryRaw.mock.calls[0])).toContain(NOT_IMPORTED_CONTACT.strings.join(''));
  });

  it('card de leads (crmTotals) usa a mesma regra', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ leads: BigInt(7) }]),
      card: { aggregate: jest.fn().mockResolvedValue({ _count: { _all: 2 }, _sum: { value: 100 } }) },
      contact: { count: jest.fn() },
    } as any;

    const totals = await new MarketingRepository(prisma).crmTotals('org-1', from, to);

    expect(totals).toEqual({ leads: 7, wonDeals: 2, wonRevenue: 100 });
    expect(prisma.contact.count).not.toHaveBeenCalled();
    expect(sqlText(prisma.$queryRaw.mock.calls[0])).toContain(`"metadata"->>'origem' IS NULL`);
  });

  it('countLeads não conta contato de cliente oculto', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ leads: BigInt(3) }]) } as any;

    expect(await countLeads(prisma, 'org-1', from, to)).toBe(3);

    expect(sqlText(prisma.$queryRaw.mock.calls[0])).toContain('"is_mystery_shopper" = false');
  });

  it('série diária também deixa o cliente oculto de fora', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) } as any;
    await new MarketingRepository(prisma).dailyLeads('org-1', from, to);

    expect(sqlText(prisma.$queryRaw.mock.calls[0])).toContain('"is_mystery_shopper" = false');
  });
});
