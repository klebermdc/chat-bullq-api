import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { CopilotService } from './copilot.service';
import { AskDto } from './dto/ask.dto';
import { CurrentOrg, Roles } from '../../common/decorators';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';

@ApiTags('Copilot (interno)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('copilot')
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Post('ask')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Pergunta ao Copiloto interno (só OWNER/ADMIN)' })
  ask(@CurrentOrg('id') orgId: string, @Body() dto: AskDto) {
    return this.copilot.ask(orgId, dto.text, dto.history ?? []);
  }
}
