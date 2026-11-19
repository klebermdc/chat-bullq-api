import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, Roles } from '../../common/decorators';
import { TeamPulseTestDto } from './team-pulse-test.dto';
import { TeamPulseService } from './team-pulse.service';

@ApiTags('Pulso do atendimento')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('team-pulse')
export class TeamPulseController {
  constructor(private readonly service: TeamPulseService) {}

  @Post('test')
  @HttpCode(200)
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({
    summary: 'Manda agora o pulso ou o fechamento à gestão (dados reais, ignora a hora e a trava)',
  })
  test(@Body() dto: TeamPulseTestDto, @CurrentOrg('id') organizationId: string) {
    return this.service.sendTest(organizationId, dto.kind, new Date());
  }
}
