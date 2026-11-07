import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrgRole } from '@prisma/client';
import { SalesReportsService } from './sales-reports.service';
import { OfpReportService } from './ofp-report.service';
import { PrismaService } from '../../database/prisma.service';

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
      providers: [
        SalesReportsService,
        { provide: OfpReportService, useValue: ofp },
        { provide: PrismaService, useValue: { ofpSalesOrder: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn() } } },
        { provide: ConfigService, useValue: { get: () => 'live' } },
      ],
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

  it('getFacets returns distinct values for admin', async () => {
    const r = await service.getFacets({ role: OrgRole.ADMIN, email: 'kleber@orlandofastpass.com.br' });
    expect(Array.isArray(r.statuses)).toBe(true);
  });

  it('getFacets forbids unmapped agent', async () => {
    await expect(service.getFacets({ role: OrgRole.AGENT, email: 'stranger@nope.com' })).rejects.toBeTruthy();
  });

  it('getOrdersPage paginates and projects, admin sees all', async () => {
    const r = await service.getOrdersPage({ role: OrgRole.ADMIN, email: 'kleber@orlandofastpass.com.br', perPage: 1, page: 1 });
    expect(r.perPage).toBe(1);
    expect(r.data.length).toBeLessThanOrEqual(1);
    expect(typeof r.total).toBe('number');
  });

  it('getOrdersPage forces agent to own vendedor (ignores query vendedor)', async () => {
    const spy = jest.spyOn(service as any, 'resolveVendedor');
    const r = await service.getOrdersPage({ role: OrgRole.AGENT, email: 'pedro@orlandofastpass.com.br', vendedor: 'Rafael' });
    expect(spy).toHaveBeenCalled();
    // all returned rows (if any) must be the agent's own vendedor, never 'Rafael'
    for (const row of r.data) expect(row.vendedor === 'Rafael').toBe(false);
  });
});

describe('SalesReportsService db source', () => {
  it('aggregates from prisma rows when source=db and table non-empty', async () => {
    const prisma = {
      ofpSalesOrder: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            externalId: 'o1', pedido: '1', cliente: 'A', emailCliente: null, telefoneCliente: null,
            vendedor: 'Pedro', fornecedor: 'JT', produto: 'Ingresso', status: 'Pendente',
            venda: 100, comissao: null, comissaoTotal: 0, porcentagemVendedor: null,
            comissaoVendedor: 10, comissaoGuia: 0, enviado: null, guia: null,
            data: new Date(2026, 6, 7), dataRaw: '07/07/2026', createdAtExt: null, updatedAtExt: null,
          },
        ]),
      },
    } as any;
    const ofp2 = {
      getProfiles: jest.fn().mockResolvedValue([]),
      getRoles: jest.fn().mockResolvedValue([]),
      getOrders: jest.fn(),
    } as any;
    const mod = await Test.createTestingModule({
      providers: [
        SalesReportsService,
        { provide: OfpReportService, useValue: ofp2 },
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'db' } },
      ],
    }).compile();
    const svc = mod.get(SalesReportsService);
    const r = await svc.getReport({ role: OrgRole.ADMIN, email: 'kleber@orlandofastpass.com.br' });
    expect(prisma.ofpSalesOrder.findMany).toHaveBeenCalled();
    expect(ofp2.getOrders).not.toHaveBeenCalled();
    expect(r.totals.orders).toBe(1);
    expect(r.totals.venda).toBe(100);
  });
});

describe('SalesReportsService name fallback (vínculo pelo nome do pedido)', () => {
  async function build(orderVendedores: string[]) {
    const ofp = {
      getProfiles: jest.fn().mockResolvedValue([
        { id: 'u1', email: 'pedro@orlandofastpass.com.br', full_name: 'Pedro' },
      ]),
      getRoles: jest.fn().mockResolvedValue([
        { user_id: 'u1', role: 'salesperson', salesperson_name: 'Pedro' },
      ]),
      getOrders: jest.fn().mockResolvedValue(
        orderVendedores.map((v, i) => ({ id: `o${i}`, vendedor: v, venda: 10, status: 'Pendente', data: '06/11/2026' })),
      ),
    } as any;
    const mod = await Test.createTestingModule({
      providers: [
        SalesReportsService,
        { provide: OfpReportService, useValue: ofp },
        { provide: PrismaService, useValue: { ofpSalesOrder: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn() } } },
        { provide: ConfigService, useValue: { get: () => 'live' } },
      ],
    }).compile();
    return mod.get(SalesReportsService);
  }

  it('links an agent with no OFP account by the first name used on orders', async () => {
    // Arrange
    const svc = await build(['Suelen', 'Pedro', 'Bárbara']);
    // Act
    const r = await svc.getReport({ role: OrgRole.AGENT, email: 'suelen@orlandofastpass.com.br', name: 'Suelen Souza' });
    // Assert
    expect(r.scope).toBe('seller');
    expect(r.seller).toBe('Suelen');
  });

  it('ignores case and accents when matching the name', async () => {
    const svc = await build(['Bárbara', 'Pedro']);
    expect(await svc.resolveOwnVendedor('barbara@x.com', 'barbara')).toBe('Bárbara');
  });

  it('prefers the full-name match over the first-name match', async () => {
    const svc = await build(['Ana', 'Ana Paula']);
    expect(await svc.resolveOwnVendedor('ana@x.com', 'Ana Paula')).toBe('Ana Paula');
  });

  it('refuses when the name matches more than one vendedor', async () => {
    const svc = await build(['Rafael', 'RAFAEL']);
    await expect(
      svc.getReport({ role: OrgRole.AGENT, email: 'rafa@x.com', name: 'Rafael' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses when there is no name and no email link', async () => {
    const svc = await build(['Suelen']);
    await expect(
      svc.getFacets({ role: OrgRole.AGENT, email: 'suelen@orlandofastpass.com.br' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps the email link as first choice', async () => {
    const svc = await build(['Suelen', 'Pedro']);
    expect(await svc.resolveOwnVendedor('pedro@orlandofastpass.com.br', 'Suelen')).toBe('Pedro');
  });
});
