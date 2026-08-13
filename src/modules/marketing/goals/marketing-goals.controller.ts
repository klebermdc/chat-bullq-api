import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, Feature } from '../../../common/decorators';
import { MarketingGoalsService } from './marketing-goals.service';
import { UpsertGoalsDto } from './dto/upsert-goals.dto';

@ApiTags('marketing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('marketing/goals')
export class MarketingGoalsController {
  constructor(private readonly service: MarketingGoalsService) {}

  @Get()
  @Feature('marketing.view')
  get(@CurrentOrg('id') orgId: string) {
    return this.service.get(orgId);
  }

  @Put()
  @Feature('marketing.manage')
  upsert(@CurrentOrg('id') orgId: string, @Body() dto: UpsertGoalsDto) {
    return this.service.upsert(orgId, dto);
  }
}
