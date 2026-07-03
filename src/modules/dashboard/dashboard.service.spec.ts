import { DashboardService } from './dashboard.service';

describe('DashboardService.applyConvFilters', () => {
  const service = new DashboardService({} as any);
  const apply = (base: any, filters: any, scope?: string) =>
    (service as any).applyConvFilters(base, filters, scope);

  it('mescla channelId/departmentId/status no where', () => {
    const where = apply({ organizationId: 'org-1' }, {
      channelId: 'ch-1', departmentId: 'dep-1', status: 'OPEN',
    });
    expect(where).toEqual({
      organizationId: 'org-1', channelId: 'ch-1', departmentId: 'dep-1', status: 'OPEN',
    });
  });

  it('honra assignedToId do filtro quando não há scope', () => {
    const where = apply({ organizationId: 'org-1' }, { assignedToId: 'u-1' });
    expect(where.assignedToId).toBe('u-1');
  });

  it('RN-05: scope sobrepõe o assignedToId do filtro (fail-closed)', () => {
    const where = apply({ organizationId: 'org-1' }, { assignedToId: 'u-OUTRO' }, 'u-AGENT');
    expect(where.assignedToId).toBe('u-AGENT');
  });

  it('ignora campos undefined', () => {
    const where = apply({ organizationId: 'org-1' }, {});
    expect(where).toEqual({ organizationId: 'org-1' });
  });
});
