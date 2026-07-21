import { Body, Controller, Delete, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { MetaCapiService } from './meta-capi.service';
import { UpsertMetaCapiDto } from './dto/upsert-meta-capi.dto';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, Roles } from '../../common/decorators';

@ApiTags('Meta CAPI')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('meta-capi')
export class MetaCapiController {
  constructor(private readonly service: MetaCapiService) {}

  @Get('config')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Config da Conversions API da org (sem token)' })
  getConfig(@CurrentOrg('id') organizationId: string) {
    return this.service.getConfig(organizationId);
  }

  @Put('config')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Cria ou atualiza a config da Conversions API' })
  upsert(@Body() dto: UpsertMetaCapiDto, @CurrentOrg('id') organizationId: string) {
    return this.service.upsert(organizationId, dto);
  }

  @Delete('config')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Remove a config da Conversions API' })
  remove(@CurrentOrg('id') organizationId: string) {
    return this.service.remove(organizationId);
  }

  @Post('test')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Dispara evento de teste (Events Manager → Test Events)' })
  test(@CurrentOrg('id') organizationId: string) {
    return this.service.sendTest(organizationId);
  }
}
