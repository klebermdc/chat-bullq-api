import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { CopilotService } from './copilot.service';
import { AskDto } from './dto/ask.dto';
import { ConsultDto } from './dto/consult.dto';
import { CopilotConsultService } from './consult/copilot-consult.service';
import {
  CurrentOrg,
  CurrentUser,
  CurrentUserRole,
  Feature,
  Roles,
} from '../../common/decorators';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';

@ApiTags('Copilot (interno)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('copilot')
export class CopilotController {
  constructor(
    private readonly copilot: CopilotService,
    private readonly consultService: CopilotConsultService,
  ) {}

  @Post('ask')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Pergunta ao Copiloto interno (só OWNER/ADMIN)' })
  ask(@CurrentOrg('id') orgId: string, @Body() dto: AskDto) {
    return this.copilot.ask(orgId, dto.text, dto.history ?? []);
  }

  @Post('consult')
  @Feature('copilot.view')
  @ApiOperation({
    summary:
      'Consulta para o vendedor com o conhecimento da IA de atendimento (todos os logados)',
  })
  consult(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Body() dto: ConsultDto,
  ) {
    return this.consultService.consult(orgId, { id: userId, role }, dto);
  }
}
