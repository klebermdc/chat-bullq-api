import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, Roles } from '../../../common/decorators';
import { AttendantGreetingSettingsService } from './attendant-greeting-settings.service';
import { UpdateAttendantGreetingSettingsDto } from './dto/update-attendant-greeting-settings.dto';

@ApiTags('Attendant Greeting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('attendant-greeting/settings')
export class AttendantGreetingSettingsController {
  constructor(private readonly service: AttendantGreetingSettingsService) {}

  @Get()
  get(@CurrentOrg('id') orgId: string) {
    return this.service.get(orgId);
  }

  @Put()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  update(
    @CurrentOrg('id') orgId: string,
    @Body() dto: UpdateAttendantGreetingSettingsDto,
  ) {
    return this.service.update(orgId, dto);
  }
}
