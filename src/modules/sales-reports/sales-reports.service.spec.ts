import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { SalesReportsService } from './sales-reports.service';
import { OfpReportService } from './ofp-report.service';

describe('SalesReportsService', () => {
  let service: SalesReportsService;
  let ofp: jest.Mocked<Pick<OfpReportService, 'getProfiles' | 'getRoles' | 'getOrders'>>;

  beforeEach(async () => {
    ofp = {
      getProfiles: jest.fn().mockResolvedValue([
        { id: 'u1', email: 'Pedro@OrlandoFastPass.com.br', full_name: 'Pedro' },
        { id: 'u2', email: 'kleber@orlandofastpass.com.br', full_name: 'Kleber' },
      ]),
      getRoles: jest.fn().mockResolvedValue([
        { user_id: 'u1', role: 'salesperson', salesperson_name: 'Pedro' },
        { user_id: 'u2', role: 'manager', salesperson_name: null },
      ]),
      getOrders: jest.fn().mockResolvedValue([
        { id: 'o1', vendedor: 'Pedro', venda: 100, comissao_vendedor: 10, status: 'Pendente', data: '07/07/2026' },
      ]),
    } as any;

    const mod = await Test.createTestingModule({
      providers: [SalesReportsService, { provide: OfpReportService, useValue: ofp }],
    }).compile();
    service = mod.get(SalesReportsService);
  });

  it('resolves vendedor by email case-insensitively', async () => {
    expect(await service.resolveVendedor('pedro@orlandofastpass.com.br')).toBe('Pedro');
  });

  it('AGENT is forced to own vendedor and ignores query vendedor', async () => {
    const r = await service.getReport({
      role: OrgRole.AGENT, email: 'pedro@orlandofastpass.com.br', vendedor: 'Rafael',
    });
    expect(r.scope).toBe('seller');
    expect(r.seller).toBe('Pedro');
    expect(ofp.getOrders).toHaveBeenCalledWith(expect.objectContaining({ vendedor: 'Pedro' }));
  });

  it('AGENT without a mapped vendedor is forbidden', async () => {
    await expect(
      service.getReport({ role: OrgRole.AGENT, email: 'stranger@nope.com' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ADMIN with no vendedor gets scope=all', async () => {
    const r = await service.getReport({ role: OrgRole.ADMIN, email: 'kleber@orlandofastpass.com.br' });
    expect(r.scope).toBe('all');
    expect(ofp.getOrders).toHaveBeenCalledWith(expect.objectContaining({ vendedor: undefined }));
  });

  it('ADMIN can filter by a specific vendedor', async () => {
    const r = await service.getReport({ role: OrgRole.ADMIN, email: 'kleber@orlandofastpass.com.br', vendedor: 'Pedro' });
    expect(r.scope).toBe('seller');
    expect(r.seller).toBe('Pedro');
  });
});
