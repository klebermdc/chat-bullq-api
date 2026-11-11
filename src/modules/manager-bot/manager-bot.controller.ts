import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { IsIn } from 'class-validator';
import { CurrentOrg, Roles } from '../../common/decorators';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { ManagerBotService } from './manager-bot.service';
import { MANAGER_REPORT_KINDS, type ManagerReportKind } from './manager-bot.types';

export class ManagerBotTestDto {
  @ApiProperty({ enum: MANAGER_REPORT_KINDS, example: 'closing' })
  @IsIn(MANAGER_REPORT_KINDS as ManagerReportKind[])
  kind!: ManagerReportKind;
}

@ApiTags('Gerente no Telegram')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('manager-bot')
export class ManagerBotController {
  constructor(private readonly service: ManagerBotService) {}

  @Post('test')
  @HttpCode(200)
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Manda agora um relatório aos chats cadastrados (dados reais, ignora a trava)' })
  test(@Body() dto: ManagerBotTestDto, @CurrentOrg('id') organizationId: string) {
    return this.service.sendReport(organizationId, dto.kind, new Date());
  }
}
