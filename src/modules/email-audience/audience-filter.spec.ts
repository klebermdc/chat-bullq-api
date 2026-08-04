import { EmailSubscriberStatus } from '@prisma/client';
import { buildAudienceWhere, parseAudienceFilter } from './audience-filter';

describe('parseAudienceFilter', () => {
  it('aceita filtro vazio', () => {
    expect(parseAudienceFilter({})).toEqual({});
    expect(parseAudienceFilter(null)).toEqual({});
  });

  it('recusa data em formato inválido', () => {
    expect(() => parseAudienceFilter({ purchasedSince: 'ontem' })).toThrow(/purchasedSince/);
  });

  it('recusa valor mínimo negativo', () => {
    expect(() => parseAudienceFilter({ minSpent: -5 })).toThrow(/minSpent/);
  });
});

describe('buildAudienceWhere', () => {
  const ORG = 'org_1';

  it('filtro vazio devolve toda a base INSCRITA', () => {
    const where = buildAudienceWhere(ORG, {});
    expect(where.organizationId).toBe(ORG);
    expect(where.status).toBe(EmailSubscriberStatus.SUBSCRIBED);
  });

  it('exige SUBSCRIBED mesmo com filtro cheio — supressão é a última palavra', () => {
    const where = buildAudienceWhere(ORG, {
      categories: ['ingresso'],
      minSpent: 1000,
      tagIds: ['t1'],
    });
    expect(where.status).toBe(EmailSubscriberStatus.SUBSCRIBED);
  });

  it('categorias viram hasSome — quem comprou qualquer uma entra', () => {
    const where = buildAudienceWhere(ORG, { categories: ['ingresso', 'hotel'] });
    expect(where.categories).toEqual({ hasSome: ['ingresso', 'hotel'] });
  });

  it('período vira faixa em lastPurchaseAt', () => {
    const where = buildAudienceWhere(ORG, {
      purchasedSince: '2026-01-01',
      purchasedUntil: '2026-06-30',
    });
    expect(where.lastPurchaseAt).toMatchObject({ gte: expect.any(Date), lte: expect.any(Date) });
  });

  it('valor mínimo vira gte', () => {
    expect(buildAudienceWhere(ORG, { minSpent: 500 }).totalSpent).toEqual({ gte: 500 });
  });

  it('etiquetas viram some na junção', () => {
    const where = buildAudienceWhere(ORG, { tagIds: ['t1', 't2'] });
    expect(where.tags).toEqual({ some: { tagId: { in: ['t1', 't2'] } } });
  });

  it('combina critérios com E, não OU', () => {
    const where = buildAudienceWhere(ORG, { categories: ['ingresso'], minSpent: 100 });
    expect(where.categories).toBeDefined();
    expect(where.totalSpent).toBeDefined();
  });

  it('fornecedores viram hasSome', () => {
    const where = buildAudienceWhere(ORG, { suppliers: ['just travel'] });
    expect(where.suppliers).toEqual({ hasSome: ['just travel'] });
  });

  it('minOrders vira gte em orderCount', () => {
    expect(buildAudienceWhere(ORG, { minOrders: 3 }).orderCount).toEqual({ gte: 3 });
  });

  it('recusa purchasedUntil inválido', () => {
    expect(() => parseAudienceFilter({ purchasedUntil: 'nunca' })).toThrow(/purchasedUntil/);
  });

  it('recusa minOrders negativo', () => {
    expect(() => parseAudienceFilter({ minOrders: -1 })).toThrow(/minOrders/);
  });
});
