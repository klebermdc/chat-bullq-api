import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import {
  CurrentOrg,
  CurrentUser,
  CurrentUserRole,
} from '../../common/decorators';
import { CrmReportsService } from './crm-reports.service';
import { DealsQueryDto } from './dto/deals-query.dto';
import { parseDealsParams, dealsRowsToCsv } from './crm-reports.mapper';

@ApiTags('crm-reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('crm-reports')
export class CrmReportsController {
  constructor(private readonly service: CrmReportsService) {}

  @Get('deals')
  getDeals(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query() q: DealsQueryDto,
  ) {
    return this.service.getDealsReport(parseDealsParams(q, orgId, userId, role));
  }

  @Get('deals/export.csv')
  async exportDeals(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query() q: DealsQueryDto,
    @Res() res: Response,
  ) {
    const params = parseDealsParams(q, orgId, userId, role);
    const report = await this.service.getDealsReport({
      ...params,
      page: 1,
      perPage: 10000,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="relatorio-deals.csv"',
    );
    res.send(dealsRowsToCsv(report.rows));
  }
}
