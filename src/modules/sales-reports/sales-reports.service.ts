import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { OfpReportService, OfpOrder } from './ofp-report.service';
import { matchVendedorByName } from './vendedor-match';
import { aggregate, computeFacets, filterOrders, projectOrder, ReportFacets, SalesReport } from './report-aggregator';

const NOT_LINKED_MESSAGE = 'Sua conta não está vinculada a um vendedor no OFP Hub.';

function dateKey(d: string | null): number {
  const m = d ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d.trim()) : null;
  if (!m) return 0;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
}

export interface GetReportInput {
  role: OrgRole;
  email: string;
  name?: string;
  vendedor?: string;
  day?: number;
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

  /** Nomes de vendedor gravados nos pedidos — a mesma base da tabela geral. */
  private async orderVendedorNames(): Promise<string[]> {
    const source = this.config.get<string>('OFP_REPORTS_SOURCE') ?? 'db';
    if (source === 'db' && (await this.prisma.ofpSalesOrder.count()) > 0) {
      const rows = await this.prisma.ofpSalesOrder.findMany({ distinct: ['vendedor'], select: { vendedor: true } });
      return rows.map((r) => r.vendedor).filter((v): v is string => !!v);
    }
    const orders = await this.ofp.getOrders({});
    return orders.map((o) => o.vendedor).filter((v): v is string => !!v);
  }

  /** E-mail vinculado no OFP Hub primeiro; senão, o nome do usuário contra o vendedor dos pedidos. */
  async resolveOwnVendedor(email: string, name?: string): Promise<string | null> {
    const byEmail = await this.resolveVendedor(email);
    if (byEmail) return byEmail;
    if (!name) return null;
    return matchVendedorByName(name, await this.orderVendedorNames());
  }

  private async requireOwnVendedor(email: string, name?: string): Promise<string> {
    const own = await this.resolveOwnVendedor(email, name);
    if (!own) throw new ForbiddenException(NOT_LINKED_MESSAGE);
    return own;
  }

  private async loadOrders(filters: { vendedor?: string; day?: number; month?: number; year?: number; status?: string; produto?: string; fornecedor?: string }): Promise<OfpOrder[]> {
    const source = this.config.get<string>('OFP_REPORTS_SOURCE') ?? 'db';
    if (source === 'db') {
      const count = await this.prisma.ofpSalesOrder.count();
      if (count > 0) {
        const where: any = {};
        if (filters.vendedor) where.vendedor = filters.vendedor;
        if (filters.status) where.status = filters.status;
        if (filters.produto) where.produto = filters.produto;
        if (filters.fornecedor) where.fornecedor = filters.fornecedor;
        if (filters.year && filters.month && filters.day) {
          const start = new Date(filters.year, filters.month - 1, filters.day);
          const end = new Date(filters.year, filters.month - 1, filters.day + 1);
          where.data = { gte: start, lt: end };
        } else if (filters.year && filters.month) {
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
      vendedor = await this.requireOwnVendedor(input.email, input.name);
      scope = 'seller';
    } else if (input.vendedor) {
      vendedor = input.vendedor;
      scope = 'seller';
    } else {
      vendedor = undefined;
      scope = 'all';
    }

    const raw = await this.loadOrders({ vendedor, day: input.day, month: input.month, year: input.year, status: input.status, produto: input.produto, fornecedor: input.fornecedor });
    const orders = filterOrders(raw, { vendedor, day: input.day, month: input.month, year: input.year, status: input.status, produto: input.produto, fornecedor: input.fornecedor, search: input.search });
    return aggregate(orders, {
      scope,
      seller: vendedor ?? null,
      month: input.month,
      year: input.year,
      includeOrders: input.includeOrders,
    });
  }

  async getOrdersPage(input: {
    role: OrgRole; email: string; name?: string;
    vendedor?: string; month?: number; year?: number;
    status?: string; produto?: string; fornecedor?: string; search?: string;
    page?: number; perPage?: number;
  }): Promise<{ data: Record<string, unknown>[]; page: number; perPage: number; total: number; totalPages: number }> {
    const isAdmin = input.role === OrgRole.OWNER || input.role === OrgRole.ADMIN;
    let vendedor = input.vendedor;
    if (!isAdmin) {
      vendedor = await this.requireOwnVendedor(input.email, input.name); // force: ignore any client-supplied vendedor
    }
    const raw = await this.loadOrders({
      vendedor, month: input.month, year: input.year,
      status: input.status, produto: input.produto, fornecedor: input.fornecedor,
    });
    const filtered = filterOrders(raw, {
      vendedor, month: input.month, year: input.year,
      status: input.status, produto: input.produto, fornecedor: input.fornecedor, search: input.search,
    });
    filtered.sort((a, b) => dateKey(b.data) - dateKey(a.data)); // mais recentes primeiro
    const total = filtered.length;
    const perPage = Math.min(200, Math.max(1, input.perPage ?? 50));
    const page = Math.max(1, input.page ?? 1);
    const start = (page - 1) * perPage;
    const data = filtered.slice(start, start + perPage).map(projectOrder);
    return { data, page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) };
  }

  async getFacets(input: { role: OrgRole; email: string; name?: string }): Promise<ReportFacets> {
    const isAdmin = input.role === OrgRole.OWNER || input.role === OrgRole.ADMIN;
    let vendedor: string | undefined;
    if (!isAdmin) {
      vendedor = await this.requireOwnVendedor(input.email, input.name);
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
