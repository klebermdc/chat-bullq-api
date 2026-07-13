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
import { LeadsQueryDto } from './dto/leads-query.dto';
import {
  parseDealsParams,
  dealsRowsToCsv,
  parseLeadsParams,
  leadsRowsToCsv,
} from './crm-reports.mapper';

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

  @Get('leads')
  getLeads(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query() q: LeadsQueryDto,
  ) {
    return this.service.getLeadsReport(parseLeadsParams(q, orgId, userId, role));
  }

  @Get('leads/export.csv')
  async exportLeads(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query() q: LeadsQueryDto,
    @Res() res: Response,
  ) {
    const params = parseLeadsParams(q, orgId, userId, role);
    const report = await this.service.getLeadsReport({
      ...params,
      page: 1,
      perPage: 10000,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="relatorio-leads.csv"',
    );
    res.send(leadsRowsToCsv(report.rows));
  }
}
