import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, Roles } from '../../../common/decorators';
import { ManagerAlertsTestDto } from './manager-alerts-test.dto';
import { ManagerAlertsService } from './manager-alerts.service';

@ApiTags('SLA de resposta')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('response-sla/manager-alerts')
export class ManagerAlertsController {
  constructor(private readonly service: ManagerAlertsService) {}

  @Post('test')
  @HttpCode(200)
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({
    summary: 'Manda agora o resumo ou o placar aos gestores (dados reais, ignora trava e silêncio)',
  })
  test(@Body() dto: ManagerAlertsTestDto, @CurrentOrg('id') organizationId: string) {
    return this.service.sendTest(organizationId, dto.kind, new Date());
  }
}
