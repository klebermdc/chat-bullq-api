import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser, CurrentUserRole, Roles } from '../../common/decorators';
import { SalesReportsService } from './sales-reports.service';
import { ReportQueryDto } from './dto/report-query.dto';
import { OfpSyncService } from './ofp-sync.service';
import { ReconciliationService } from './reconciliation.service';
import { PrismaService } from '../../database/prisma.service';

@ApiTags('sales-reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('sales-reports')
export class SalesReportsController {
  constructor(
    private readonly service: SalesReportsService,
    private readonly sync: OfpSyncService,
    private readonly reconciliation: ReconciliationService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getReport(
    @CurrentUser('email') email: string,
    @CurrentUserRole() role: OrgRole,
    @Query() q: ReportQueryDto,
  ) {
    return this.service.getReport({
      role, email,
      vendedor: q.vendedor,
      day: q.day,
      month: q.month,
      year: q.year,
      status: q.status,
      produto: q.produto,
      fornecedor: q.fornecedor,
      search: q.search,
      includeOrders: q.includeOrders === 'true',
    });
  }

  @Get('orders')
  getOrders(
    @CurrentUser('email') email: string,
    @CurrentUserRole() role: OrgRole,
    @Query() q: ReportQueryDto,
  ) {
    return this.service.getOrdersPage({
      role, email,
      vendedor: q.vendedor, month: q.month, year: q.year,
      status: q.status, produto: q.produto, fornecedor: q.fornecedor, search: q.search,
      page: q.page, perPage: q.per_page,
    });
  }

  @Get('facets')
  getFacets(@CurrentUser('email') email: string, @CurrentUserRole() role: OrgRole) {
    return this.service.getFacets({ role, email });
  }

  @Get('vendedores')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  getVendedores() {
    return this.service.getVendedores();
  }

  @Post('sync')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  runSync() {
    return this.sync.sync();
  }

  @Get('sync-state')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  syncState() {
    return this.prisma.ofpSyncState.findUnique({ where: { id: 1 } });
  }

  // ── E5.2b — Reconciliação (pedidos do HUB sem card) ──────────────────
  @Get('reconciliation')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  listReconciliation(@Query() q: { sinceDays?: string; limit?: string; minScore?: string }) {
    return this.reconciliation.listOrphans({
      sinceDays: q.sinceDays ? Number(q.sinceDays) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
      minScore: q.minScore ? Number(q.minScore) : undefined,
    });
  }

  @Post('reconciliation/link')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  linkReconciliation(
    @CurrentOrg('id') orgId: string,
    @Body() body: { orderExternalId: string; cardId: string },
  ) {
    return this.reconciliation.link(body.orderExternalId, body.cardId, orgId);
  }
}
