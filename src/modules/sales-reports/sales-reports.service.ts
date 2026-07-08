import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { OfpReportService, OfpOrder } from './ofp-report.service';
import { aggregate, computeFacets, filterOrders, ReportFacets, SalesReport } from './report-aggregator';

export interface GetReportInput {
  role: OrgRole;
  email: string;
  vendedor?: string;
  month?: number;
  year?: number;
  status?: string;
  produto?: string;
  fornecedor?: string;
  search?: string;
  includeOrders?: boolean;
}

@Injectable()
export class SalesReportsService {
  constructor(
    private readonly ofp: OfpReportService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private async vendedorMap(): Promise<Map<string, string>> {
    const [profiles, roles] = await Promise.all([this.ofp.getProfiles(), this.ofp.getRoles()]);
    const nameByUser = new Map<string, string | null>();
    for (const r of roles) nameByUser.set(r.user_id, r.salesperson_name);
    const map = new Map<string, string>();
    for (const p of profiles) {
      if (!p.email) continue;
      const name = nameByUser.get(p.id);
      if (name) map.set(p.email.toLowerCase(), name);
    }
    return map;
  }

  async resolveVendedor(email: string): Promise<string | null> {
    const map = await this.vendedorMap();
    return map.get(email.toLowerCase()) ?? null;
  }

  private async loadOrders(filters: { vendedor?: string; month?: number; year?: number; status?: string; produto?: string; fornecedor?: string }): Promise<OfpOrder[]> {
    const source = this.config.get<string>('OFP_REPORTS_SOURCE') ?? 'db';
    if (source === 'db') {
      const count = await this.prisma.ofpSalesOrder.count();
      if (count > 0) {
        const where: any = {};
        if (filters.vendedor) where.vendedor = filters.vendedor;
        if (filters.status) where.status = filters.status;
        if (filters.produto) where.produto = filters.produto;
        if (filters.fornecedor) where.fornecedor = filters.fornecedor;
        if (filters.year && filters.month) {
          const start = new Date(filters.year, filters.month - 1, 1);
          const end = new Date(filters.year, filters.month, 1);
          where.data = { gte: start, lt: end };
        }
        const rows = await this.prisma.ofpSalesOrder.findMany({ where });
        return rows.map((r) => ({
          id: r.externalId,
          user_id: null,
          pedido: r.pedido,
          cliente: r.cliente,
          email_cliente: r.emailCliente,
          telefone_cliente: r.telefoneCliente,
          vendedor: r.vendedor,
          venda: r.venda == null ? null : Number(r.venda),
          comissao: r.comissao == null ? null : Number(r.comissao),
          comissao_total: r.comissaoTotal == null ? null : Number(r.comissaoTotal),
          porcentagem_vendedor: r.porcentagemVendedor == null ? null : Number(r.porcentagemVendedor),
          comissao_vendedor: r.comissaoVendedor == null ? null : Number(r.comissaoVendedor),
          fornecedor: r.fornecedor,
          produto: r.produto,
          data: r.dataRaw,
          status: r.status,
          enviado: r.enviado,
          guia: r.guia,
          comissao_guia: r.comissaoGuia == null ? null : Number(r.comissaoGuia),
          created_at: r.createdAtExt ? r.createdAtExt.toISOString() : null,
          updated_at: r.updatedAtExt ? r.updatedAtExt.toISOString() : null,
        })) as OfpOrder[];
      }
    }
    return this.ofp.getOrders(filters);
  }

  async getReport(input: GetReportInput): Promise<SalesReport> {
    const isAdmin = input.role === OrgRole.OWNER || input.role === OrgRole.ADMIN;

    let vendedor: string | undefined;
    let scope: 'all' | 'seller';

    if (!isAdmin) {
      const own = await this.resolveVendedor(input.email);
      if (!own) throw new ForbiddenException('Sua conta não está vinculada a um vendedor no OFP Hub.');
      vendedor = own;
      scope = 'seller';
    } else if (input.vendedor) {
      vendedor = input.vendedor;
      scope = 'seller';
    } else {
      vendedor = undefined;
      scope = 'all';
    }

    const raw = await this.loadOrders({ vendedor, month: input.month, year: input.year, status: input.status, produto: input.produto, fornecedor: input.fornecedor });
    const orders = filterOrders(raw, { vendedor, month: input.month, year: input.year, status: input.status, produto: input.produto, fornecedor: input.fornecedor, search: input.search });
    return aggregate(orders, {
      scope,
      seller: vendedor ?? null,
      month: input.month,
      year: input.year,
      includeOrders: input.includeOrders,
    });
  }

  async getFacets(input: { role: OrgRole; email: string }): Promise<ReportFacets> {
    const isAdmin = input.role === OrgRole.OWNER || input.role === OrgRole.ADMIN;
    let vendedor: string | undefined;
    if (!isAdmin) {
      const own = await this.resolveVendedor(input.email);
      if (!own) throw new ForbiddenException('Sua conta não está vinculada a um vendedor no OFP Hub.');
      vendedor = own;
    }
    const orders = await this.loadOrders({ vendedor });
    return computeFacets(orders);
  }

  async getVendedores(): Promise<Array<{ nome: string; email: string; role: string }>> {
    const [profiles, roles] = await Promise.all([this.ofp.getProfiles(), this.ofp.getRoles()]);
    const profById = new Map(profiles.map((p) => [p.id, p]));
    return roles
      .filter((r) => r.salesperson_name)
      .map((r) => ({
        nome: r.salesperson_name as string,
        email: profById.get(r.user_id)?.email ?? '',
        role: r.role ?? '',
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }
}
