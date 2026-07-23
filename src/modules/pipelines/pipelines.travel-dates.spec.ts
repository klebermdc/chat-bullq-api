import { latestTravelStartByContact } from './pipelines.service';

describe('latestTravelStartByContact', () => {
  it('devolve a startDate da proposta MAIS RECENTE de cada contato', () => {
    const out = latestTravelStartByContact([
      { contactId: 'c1', startDate: new Date('2026-08-10'), createdAt: new Date('2026-07-01') },
      { contactId: 'c1', startDate: new Date('2026-12-20'), createdAt: new Date('2026-07-05') },
      { contactId: 'c2', startDate: new Date('2026-09-01'), createdAt: new Date('2026-06-30') },
    ]);
    expect(out['c1']).toBe(new Date('2026-12-20').toISOString());
    expect(out['c2']).toBe(new Date('2026-09-01').toISOString());
  });

  it('contato sem proposta simplesmente não aparece no mapa', () => {
    const out = latestTravelStartByContact([]);
    expect(out['cX']).toBeUndefined();
  });
});
