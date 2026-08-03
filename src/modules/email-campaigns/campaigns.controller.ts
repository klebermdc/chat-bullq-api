import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser } from '../../common/decorators';
import { CampaignsService } from './campaigns.service';
import { CampaignDispatchService } from './campaign-dispatch.service';
import { CampaignStatsService } from './campaign-stats.service';
import { UpsertCampaignDto } from './dto/upsert-campaign.dto';

@ApiTags('Email · Campanhas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('email/campaigns')
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly dispatch: CampaignDispatchService,
    private readonly stats: CampaignStatsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista campanhas' })
  async list(@CurrentOrg('id') orgId: string, @Query('page') page = 1, @Query('limit') limit = 20) {
    const p = Number(page) || 1;
    const l = Math.min(Number(limit) || 20, 100);
    const [items, total] = await this.campaigns.list(orgId, p, l);
    return { items, total, page: p, limit: l };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha uma campanha' })
  get(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.campaigns.findOne(id, orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Cria campanha (rascunho)' })
  create(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpsertCampaignDto,
  ) {
    return this.campaigns.create(orgId, userId, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Edita campanha em rascunho' })
  update(@Param('id') id: string, @CurrentOrg('id') orgId: string, @Body() dto: UpsertCampaignDto) {
    return this.campaigns.update(id, orgId, dto);
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Dispara a campanha' })
  send(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.dispatch.dispatch(id, orgId);
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Retoma campanha travada em envio (seguro, não duplica)' })
  resume(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.dispatch.resume(id, orgId);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Números da campanha' })
  statsFor(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.stats.forCampaign(id, orgId);
  }

  @Get(':id/failures')
  @ApiOperation({ summary: 'Falhas com o motivo real do provedor' })
  failures(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.stats.failures(id, orgId);
  }
}
