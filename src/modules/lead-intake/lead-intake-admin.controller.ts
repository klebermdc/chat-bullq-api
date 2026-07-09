import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, Roles } from '../../common/decorators';
import { LeadIntakeService } from './lead-intake.service';

@ApiTags('Lead Intake')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Roles(OrgRole.OWNER, OrgRole.ADMIN)
@Controller('lead-intake')
export class LeadIntakeAdminController {
  constructor(private readonly service: LeadIntakeService) {}

  @Get('config')
  @ApiOperation({ summary: 'Status do webhook de entrada de lead' })
  getConfig(@CurrentOrg('id') orgId: string) {
    return this.service.getConfig(orgId);
  }

  @Post('secret/rotate')
  @ApiOperation({ summary: 'Gera/rotaciona o secret do webhook (retorna uma vez)' })
  rotate(@CurrentOrg('id') orgId: string) {
    return this.service.rotateSecret(orgId);
  }
}
