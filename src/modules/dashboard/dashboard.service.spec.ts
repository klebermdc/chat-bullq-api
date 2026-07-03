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

describe('DashboardService.getLeadsReport', () => {
  const range = { from: new Date('2026-07-01'), to: new Date('2026-07-31') };

  const buildPrisma = (convs: any[], msgs: any[]) => ({
    conversation: { findMany: jest.fn().mockResolvedValue(convs) },
    message: { findMany: jest.fn().mockResolvedValue(msgs) },
  });

  it('conta novos leads = conversas criadas no período', async () => {
    const prisma = buildPrisma(
      [
        { id: 'c1', assignedToId: 'v1', status: 'OPEN', createdAt: new Date('2026-07-02'), firstResponseAt: null, assignedTo: { id: 'v1', name: 'Vend 1', avatarUrl: null } },
        { id: 'c2', assignedToId: null, status: 'PENDING', createdAt: new Date('2026-07-03'), firstResponseAt: null, assignedTo: null },
      ],
      [],
    );
    const service = new DashboardService(prisma as any);
    const r = await service.getLeadsReport('org-1', { ...range });
    expect(r.newLeads).toBe(2);
  });

  it('proativo = 1ª msg OUTBOUND; respondido = tem INBOUND depois', async () => {
    const prisma = buildPrisma(
      [
        { id: 'c1', assignedToId: 'v1', status: 'OPEN', createdAt: new Date('2026-07-02'), firstResponseAt: new Date('2026-07-02T01:00:00Z'), assignedTo: { id: 'v1', name: 'Vend 1', avatarUrl: null } },
        { id: 'c2', assignedToId: 'v1', status: 'OPEN', createdAt: new Date('2026-07-02'), firstResponseAt: null, assignedTo: { id: 'v1', name: 'Vend 1', avatarUrl: null } },
        { id: 'c3', assignedToId: 'v1', status: 'OPEN', createdAt: new Date('2026-07-02'), firstResponseAt: null, assignedTo: { id: 'v1', name: 'Vend 1', avatarUrl: null } },
      ],
      [
        { conversationId: 'c1', direction: 'OUTBOUND', createdAt: new Date('2026-07-02T00:00:00Z') },
        { conversationId: 'c1', direction: 'INBOUND', createdAt: new Date('2026-07-02T00:30:00Z') },
        { conversationId: 'c2', direction: 'OUTBOUND', createdAt: new Date('2026-07-02T00:00:00Z') },
        { conversationId: 'c3', direction: 'INBOUND', createdAt: new Date('2026-07-02T00:00:00Z') },
      ],
    );
    const service = new DashboardService(prisma as any);
    const r = await service.getLeadsReport('org-1', { ...range });
    expect(r.proactiveLeads).toBe(2);
    expect(r.receptiveLeads).toBe(1); // c3: 1ª msg INBOUND
    expect(r.respondedLeads).toBe(1);
    expect(r.respondedRate).toBe(50);
  });

  it('bySeller agrupa por assignedToId; não-atribuídos na linha null', async () => {
    const prisma = buildPrisma(
      [
        { id: 'c1', assignedToId: 'v1', status: 'OPEN', createdAt: new Date('2026-07-02'), firstResponseAt: null, assignedTo: { id: 'v1', name: 'Vend 1', avatarUrl: null } },
        { id: 'c2', assignedToId: 'v1', status: 'CLOSED', createdAt: new Date('2026-07-02'), firstResponseAt: null, assignedTo: { id: 'v1', name: 'Vend 1', avatarUrl: null } },
        { id: 'c3', assignedToId: null, status: 'PENDING', createdAt: new Date('2026-07-02'), firstResponseAt: null, assignedTo: null },
      ],
      [],
    );
    const service = new DashboardService(prisma as any);
    const r = await service.getLeadsReport('org-1', { ...range });
    const v1 = r.bySeller.find((s) => s.seller?.id === 'v1')!;
    expect(v1.received).toBe(2);
    expect(v1.open).toBe(1);
    expect(v1.closed).toBe(1);
    const fila = r.bySeller.find((s) => s.seller === null)!;
    expect(fila.received).toBe(1);
  });

  it('respondedRate = null quando não há leads proativos', async () => {
    const prisma = buildPrisma([], []);
    const service = new DashboardService(prisma as any);
    const r = await service.getLeadsReport('org-1', { ...range });
    expect(r.newLeads).toBe(0);
    expect(r.respondedRate).toBeNull();
  });
});

describe('DashboardService filtros nos endpoints existentes', () => {
  const range = { from: new Date('2026-07-01'), to: new Date('2026-07-31') };

  it('getVolumeByDay aplica channelId/status no where', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new DashboardService({ conversation: { findMany } } as any);
    await service.getVolumeByDay('org-1', range, undefined, { channelId: 'ch-1', status: 'CLOSED' } as any);
    const where = findMany.mock.calls[0][0].where;
    expect(where.channelId).toBe('ch-1');
    expect(where.status).toBe('CLOSED');
  });
});
