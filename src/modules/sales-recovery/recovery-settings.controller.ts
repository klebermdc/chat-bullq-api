import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, Roles } from '../../common/decorators';
import { RecoverySettingsService } from './recovery-settings.service';
import { UpdateRecoverySettingsDto } from './dto/update-recovery-settings.dto';

/**
 * Config de recuperação de vendas por org (nome dos templates HSM do outreach).
 * Escopado por org, restrito a OWNER/ADMIN — mesma política do CRUD de canais.
 */
@ApiTags('Recovery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Roles(OrgRole.OWNER, OrgRole.ADMIN)
@Controller('recovery/settings')
export class RecoverySettingsController {
  constructor(private readonly service: RecoverySettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Configuração de recuperação da org (com defaults).' })
  get(@CurrentOrg('id') orgId: string) {
    return this.service.getForOrg(orgId);
  }

  @Patch()
  @ApiOperation({ summary: 'Atualiza (upsert) a configuração de recuperação da org.' })
  update(
    @CurrentOrg('id') orgId: string,
    @Body() dto: UpdateRecoverySettingsDto,
  ) {
    return this.service.update(orgId, dto);
  }
}
