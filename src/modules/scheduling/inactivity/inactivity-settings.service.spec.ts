import { InactivitySettingsService, DEFAULT_INACTIVITY_SETTINGS } from './inactivity-settings.service';

function makeDeps() {
  const store = new Map<string, any>();
  const repo = {
    find: jest.fn(async (org: string) => store.get(org) ?? null),
    upsert: jest.fn(async (org: string, data: any) => {
      const row = { organizationId: org, ...DEFAULT_INACTIVITY_SETTINGS, ...store.get(org), ...data };
      store.set(org, row);
      return row;
    }),
  };
  return { service: new InactivitySettingsService(repo as any), repo };
}

describe('InactivitySettingsService', () => {
  it('get retorna defaults quando não existe row', async () => {
    const { service } = makeDeps();
    const s = await service.get('org1');
    expect(s.enabled).toBe(true);
    expect(s.bandsDays).toEqual([3, 7, 15, 30]);
    expect(s.autoReengage).toBe(false);
  });
  it('update persiste e mescla', async () => {
    const { service } = makeDeps();
    const s = await service.update('org1', { autoReengage: true, bandsDays: [2, 5] });
    expect(s.autoReengage).toBe(true);
    expect(s.bandsDays).toEqual([2, 5]);
  });
  it('expõe reengageOnlyAiParked no get (default false; persiste quando setado)', async () => {
    const { service } = makeDeps();
    expect((await service.get('org1')).reengageOnlyAiParked).toBe(false);
    await service.update('org1', { reengageOnlyAiParked: true });
    expect((await service.get('org1')).reengageOnlyAiParked).toBe(true);
  });
});
