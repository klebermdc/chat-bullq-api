import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, CurrentUserRole, Roles } from '../../common/decorators';
import { SalesReportsService } from './sales-reports.service';
import { ReportQueryDto } from './dto/report-query.dto';
import { OfpSyncService } from './ofp-sync.service';
import { PrismaService } from '../../database/prisma.service';

@ApiTags('sales-reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('sales-reports')
export class SalesReportsController {
  constructor(
    private readonly service: SalesReportsService,
    private readonly sync: OfpSyncService,
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
}
