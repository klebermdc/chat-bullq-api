import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentOrg } from '../../common/decorators';
import { JwtAuthGuard, OrgGuard } from '../../common/guards';
import { ExchangeRatesService } from './exchange-rates.service';

@ApiTags('exchange-rates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('exchange-rates')
export class ExchangeRatesController {
  constructor(private readonly service: ExchangeRatesService) {}

  /** Câmbio do dia nas operadoras; qualquer usuário logado da org. */
  @Get()
  list(@CurrentOrg('id') organizationId: string) {
    return this.service.listFor(organizationId);
  }
}
