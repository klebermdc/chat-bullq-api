import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, CurrentUserRole, Roles } from '../../common/decorators';
import { SalesReportsService } from './sales-reports.service';
import { ReportQueryDto } from './dto/report-query.dto';

@ApiTags('sales-reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('sales-reports')
export class SalesReportsController {
  constructor(private readonly service: SalesReportsService) {}

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
      includeOrders: q.includeOrders === 'true',
    });
  }

  @Get('vendedores')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  getVendedores() {
    return this.service.getVendedores();
  }
}
