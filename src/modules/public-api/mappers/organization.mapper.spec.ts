import { mapOrganization } from './organization.mapper';

describe('mapOrganization', () => {
  it('expõe só campos públicos e NUNCA vaza settings/config de IA', () => {
    const out = mapOrganization({
      id: 'o1', name: 'Orlando FastPass', slug: 'ofp', logoUrl: 'http://x/l.png', plan: 'pro',
      createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-02-01'), deletedAt: null,
      settings: { secretKey: 'SECRET' }, aiEnabled: true, aiBusinessHours: { mon: '9-18' },
      aiMonthlyTokenCap: 100000, aiOutOfHoursMessage: 'fechado',
    } as any);
    expect(out).toEqual({ id: 'o1', name: 'Orlando FastPass', slug: 'ofp', logoUrl: 'http://x/l.png', plan: 'pro', createdAt: new Date('2026-01-01') });
    expect((out as any).settings).toBeUndefined();
    expect((out as any).aiEnabled).toBeUndefined();
    expect((out as any).aiMonthlyTokenCap).toBeUndefined();
    expect((out as any).updatedAt).toBeUndefined();
  });
});
