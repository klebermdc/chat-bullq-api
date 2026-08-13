import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, Feature } from '../../../common/decorators';
import { MarketingMetricsService } from './marketing-metrics.service';
import { MarketingGoalsService } from '../goals/marketing-goals.service';
import { PeriodQueryDto } from './dto/period-query.dto';
import { parsePeriod } from './period.util';

@ApiTags('marketing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Feature('marketing.view')
@Controller('marketing')
export class MarketingMetricsController {
  constructor(
    private readonly metricsService: MarketingMetricsService,
    private readonly goalsService: MarketingGoalsService,
  ) {}

  @Get('overview')
  async overview(@CurrentOrg('id') orgId: string, @Query() query: PeriodQueryDto) {
    const { from, to } = parsePeriod(query);
    const goals = await this.goalsService.get(orgId);
    return this.metricsService.getOverview(orgId, from, to, goals);
  }

  @Get('daily')
  daily(@CurrentOrg('id') orgId: string, @Query() query: PeriodQueryDto) {
    const { from, to } = parsePeriod(query);
    return this.metricsService.getDailySeries(orgId, from, to);
  }
}
