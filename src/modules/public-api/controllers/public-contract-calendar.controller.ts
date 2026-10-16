import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { OrgRole } from '@prisma/client';
import { CurrentOrg, CurrentUser, CurrentUserRole } from '../../../common/decorators';
import { ApiKeyAuthGuard } from '../../../common/guards';
import { resolveCalendarWindow, todayInOrlando } from '../../contracts/calendar/calendar-window';
import { ContractCalendarService } from '../../contracts/calendar/contract-calendar.service';
import { ContractCalendarQueryDto } from '../dto/contract-calendar.public.dto';
import { ApiKeyThrottleGuard } from '../guards/api-key-throttle.guard';

/**
 * Eventos desejados no Google Agenda (parques e compra do Multipass). Quem
 * sincroniza é a rotina do Claude, pelo MCP. O papel vem da chave de API:
 * AGENT só recebe os contratos que criou.
 *
 * A rota não fica em `public/contracts/...`, que é do aceite por token.
 */
@ApiTags('Public API · Contract calendar')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottleGuard)
@Controller('public/contract-calendar')
export class PublicContractCalendarController {
  constructor(private readonly calendar: ContractCalendarService) {}

  @Get()
  @ApiOperation({
    summary: 'Contract calendar events (park days + Multipass purchase reminders), America/New_York',
  })
  async list(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Query() q: ContractCalendarQueryDto,
  ) {
    const window = resolveCalendarWindow(q, todayInOrlando());
    return this.calendar.events(orgId, { userId, role }, window, q.guide);
  }
}
