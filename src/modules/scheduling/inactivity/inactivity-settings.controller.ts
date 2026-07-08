import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, Roles } from '../../../common/decorators';
import { InactivitySettingsService } from './inactivity-settings.service';
import { UpdateInactivitySettingsDto } from './dto/update-inactivity-settings.dto';

@ApiTags('Inactivity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('inactivity/settings')
export class InactivitySettingsController {
  constructor(private readonly service: InactivitySettingsService) {}

  @Get()
  get(@CurrentOrg('id') orgId: string) {
    return this.service.get(orgId);
  }

  @Put()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  update(@CurrentOrg('id') orgId: string, @Body() dto: UpdateInactivitySettingsDto) {
    return this.service.update(orgId, dto);
  }
}
