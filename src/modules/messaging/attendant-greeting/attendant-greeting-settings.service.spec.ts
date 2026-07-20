import { AttendantGreetingSettingsService } from './attendant-greeting-settings.service';

describe('AttendantGreetingSettingsService', () => {
  const makeRepo = (row: any) => ({
    find: jest.fn().mockResolvedValue(row),
    upsert: jest.fn().mockImplementation((orgId, data) =>
      Promise.resolve({ organizationId: orgId, ...data }),
    ),
  });

  it('retorna defaults quando não há row', async () => {
    const repo = makeRepo(null);
    const svc = new AttendantGreetingSettingsService(repo as any);
    const res = await svc.get('org1');
    expect(res.enabled).toBe(true);
    expect(res.template).toContain('{atendente}');
    expect(res.organizationId).toBe('org1');
  });

  it('sobrepõe defaults com a row existente', async () => {
    const repo = makeRepo({
      organizationId: 'org1',
      enabled: false,
      template: 'Olá, sou {atendente}',
    });
    const svc = new AttendantGreetingSettingsService(repo as any);
    const res = await svc.get('org1');
    expect(res.enabled).toBe(false);
    expect(res.template).toBe('Olá, sou {atendente}');
  });

  it('update faz upsert com o patch', async () => {
    const repo = makeRepo(null);
    const svc = new AttendantGreetingSettingsService(repo as any);
    await svc.update('org1', { enabled: false });
    expect(repo.upsert).toHaveBeenCalledWith('org1', { enabled: false });
  });
});
