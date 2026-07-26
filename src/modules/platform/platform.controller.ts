import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, SuperAdminGuard } from '../../common/guards';
import { PlatformService } from './platform.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';

@ApiTags('Platform')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('platform')
export class PlatformController {
  constructor(private readonly service: PlatformService) {}

  @Post('organizations')
  create(@Body() dto: CreateOrganizationDto) {
    return this.service.createOrganization(dto);
  }

  @Get('organizations')
  list() {
    return this.service.listOrganizations();
  }

  @Patch('organizations/:id/suspend')
  suspend(@Param('id') id: string) {
    return this.service.setSuspended(id, true);
  }

  @Patch('organizations/:id/activate')
  activate(@Param('id') id: string) {
    return this.service.setSuspended(id, false);
  }
}
