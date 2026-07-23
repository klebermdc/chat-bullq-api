import { Test } from '@nestjs/testing';
import { OrgRole, CardStatus } from '@prisma/client';
import { CrmReportsService } from './crm-reports.service';
import { PrismaService } from '../../database/prisma.service';

describe('buildDealsWhere', () => {
  let service: CrmReportsService;
  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [CrmReportsService, { provide: PrismaService, useValue: {} }],
    }).compile();
    service = mod.get(CrmReportsService);
  });

  it('aplica pipeline, status, faixa de valor e período', () => {
    const from = new Date('2026-07-01');
    const to = new Date('2026-07-31');
    const w: any = service.buildDealsWhere({
      orgId: 'o1',
      role: OrgRole.ADMIN,
      userId: 'u1',
      pipelineId: 'p1',
      status: CardStatus.WON,
      valueMin: 100,
      valueMax: 500,
      from,
      to,
      dateField: 'createdAt',
    } as any);
    expect(w.organizationId).toBe('o1');
    expect(w.pipelineId).toBe('p1');
    expect(w.status).toBe('WON');
    expect(w.value).toEqual({ gte: 100, lte: 500 });
    expect(w.createdAt).toEqual({ gte: from, lte: to });
    expect(w.OR).toBeUndefined(); // ADMIN não restringe dono
  });

  it('hasProposal=true filtra contatos com proposta', () => {
    const w: any = service.buildDealsWhere({
      orgId: 'o1',
      role: OrgRole.ADMIN,
      userId: 'u1',
      hasProposal: true,
    } as any);
    expect(w.contact).toEqual({ is: { proposals: { some: {} } } });
  });

  it('dateField=closedAt filtra pela data de fechamento', () => {
    const to = new Date('2026-07-31');
    const w: any = service.buildDealsWhere({
      orgId: 'o1',
      role: OrgRole.ADMIN,
      userId: 'u1',
      to,
      dateField: 'closedAt',
    } as any);
    expect(w.closedAt).toEqual({ lte: to });
  });
});
