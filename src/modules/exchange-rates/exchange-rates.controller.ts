import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { CurrentOrg, CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { SetManualRateDto } from './dto/set-manual-rate.dto';
import { ExchangeRatesService } from './exchange-rates.service';

@ApiTags('exchange-rates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('exchange-rates')
export class ExchangeRatesController {
  constructor(private readonly service: ExchangeRatesService) {}

  /** Câmbio do dia nas operadoras; qualquer usuário logado da org. */
  @Get()
  list(@CurrentOrg('id') organizationId: string) {
    return this.service.listFor(organizationId);
  }

  /** Lançamento manual (AZ): só ADM/Owner. */
  @Put(':code')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  setManual(
    @CurrentOrg('id') organizationId: string,
    @CurrentUser('id') userId: string,
    @Param('code') code: string,
    @Body() body: SetManualRateDto,
  ) {
    return this.service.setManual(organizationId, userId, code, body.value);
  }
}
