import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, Feature } from '../../../common/decorators';
import { MarketingMetricsService } from './marketing-metrics.service';
import { MarketingGoalsService } from '../goals/marketing-goals.service';
import { PeriodQueryDto } from './dto/period-query.dto';

const MS_PER_DAY = 86_400_000;

/**
 * `to` é interpretado como o fim do dia civil (23:59:59.999 UTC), não meia-
 * noite — senão qualquer consulta que filtre por `<= to` derruba o último
 * dia do período silenciosamente.
 */
function endOfDayUtc(dateStr: string): Date {
  const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
  return new Date(startOfDay.getTime() + MS_PER_DAY - 1);
}

/** Recusa período invertido: um `from > to` devolvendo zeros em silêncio
 *  é indistinguível de "sem dados", o que manda alguém caçar um bug de
 *  ingestão que não existe. */
function parsePeriod(query: PeriodQueryDto): { from: Date; to: Date } {
  const from = new Date(`${query.from}T00:00:00.000Z`);
  const to = endOfDayUtc(query.to);

  if (from.getTime() > to.getTime()) {
    throw new BadRequestException('O parâmetro "from" não pode ser posterior a "to".');
  }

  return { from, to };
}

@ApiTags('marketing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Feature('marketing.view')
@Controller('marketing')
export class MarketingMetricsController {
  constructor(
    private readonly metricsService: MarketingMetricsService,
    private readonly goalsService: MarketingGoalsService,
  ) {}

  @Get('overview')
  async overview(@CurrentOrg('id') orgId: string, @Query() query: PeriodQueryDto) {
    const { from, to } = parsePeriod(query);
    const goals = await this.goalsService.get(orgId);
    return this.metricsService.getOverview(orgId, from, to, goals);
  }

  @Get('daily')
  daily(@CurrentOrg('id') orgId: string, @Query() query: PeriodQueryDto) {
    const { from, to } = parsePeriod(query);
    return this.metricsService.getDailySeries(orgId, from, to);
  }
}
