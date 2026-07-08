import { ForbiddenException, Injectable } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { OfpReportService } from './ofp-report.service';
import { aggregate, filterOrders, SalesReport } from './report-aggregator';

export interface GetReportInput {
  role: OrgRole;
  email: string;
  vendedor?: string;
  month?: number;
  year?: number;
  includeOrders?: boolean;
}

@Injectable()
export class SalesReportsService {
  constructor(private readonly ofp: OfpReportService) {}

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

    const raw = await this.ofp.getOrders({ vendedor, month: input.month, year: input.year });
    const orders = filterOrders(raw, { vendedor, month: input.month, year: input.year });
    return aggregate(orders, {
      scope,
      seller: vendedor ?? null,
      month: input.month,
      year: input.year,
      includeOrders: input.includeOrders,
    });
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
