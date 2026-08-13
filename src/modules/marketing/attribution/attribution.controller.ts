import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, Feature } from '../../../common/decorators';
import { AttributionService } from './attribution.service';
import { PeriodQueryDto } from '../metrics/dto/period-query.dto';
import { parsePeriod } from '../metrics/period.util';

@ApiTags('marketing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Feature('marketing.view')
@Controller('marketing')
export class AttributionController {
  constructor(private readonly attributionService: AttributionService) {}

  /**
   * `coverage` vai dentro de `data` (não em `meta`): o `ResponseInterceptor`
   * global constrói `meta` sozinho (só `{ timestamp }`) e não repassa nada
   * que o controller devolva. Mover `coverage` para `meta` exigiria mudar
   * o interceptor global — fora do escopo desta fatia.
   */
  @Get('attribution')
  attribution(@CurrentOrg('id') orgId: string, @Query() query: PeriodQueryDto) {
    const { from, to } = parsePeriod(query);
    return this.attributionService.getAttribution(orgId, from, to);
  }

  @Get('creatives')
  creatives(@CurrentOrg('id') orgId: string, @Query() query: PeriodQueryDto) {
    const { from, to } = parsePeriod(query);
    return this.attributionService.getCreatives(orgId, from, to);
  }
}
