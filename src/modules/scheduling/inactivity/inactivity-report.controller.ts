import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import type { Response } from 'express';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import {
  CurrentOrg,
  CurrentUser,
  CurrentUserRole,
} from '../../../common/decorators';
import { resolveAssignmentScope } from '../../messaging/conversations/conversation-scope';
import { InactivityReportService } from './inactivity-report.service';

@ApiTags('Inactivity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('inactivity/report')
export class InactivityReportController {
  constructor(private readonly service: InactivityReportService) {}

  @Get()
  @ApiQuery({ name: 'band', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  report(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('band') band?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const assignedToId = resolveAssignmentScope(role, userId);
    // Coerção defensiva: nunca deixa NaN/negativos chegarem no Prisma.
    const bandNum = band !== undefined ? parseInt(band, 10) : NaN;
    const pageNum = Math.max(1, parseInt(page ?? '', 10) || 1);
    const pageSizeParsed = parseInt(pageSize ?? '', 10);
    const pageSizeNum = Number.isNaN(pageSizeParsed)
      ? 20
      : Math.min(200, Math.max(1, pageSizeParsed));
    return this.service.report({
      organizationId: orgId,
      assignedToId,
      band: Number.isNaN(bandNum) ? undefined : bandNum,
      page: pageNum,
      pageSize: pageSizeNum,
    });
  }

  @Get('export')
  async export(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Res() res: Response,
  ) {
    const assignedToId = resolveAssignmentScope(role, userId);
    const csv = await this.service.csv({
      organizationId: orgId,
      assignedToId,
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="inatividade.csv"',
    );
    res.send(csv);
  }
}
