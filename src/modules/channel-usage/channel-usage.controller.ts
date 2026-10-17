import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, Roles } from '../../common/decorators';
import { ChannelUsageService } from './channel-usage.service';
import { UsageQueryDto } from './dto/usage-query.dto';
import { SetPricingDto } from './dto/pricing.dto';
import { RangeQueryDto } from './dto/range-query.dto';
import { resolveUsageRange } from './usage-range.util';

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
function nextMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

@ApiTags('channel-usage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('channel-usage')
export class ChannelUsageController {
  constructor(private readonly service: ChannelUsageService) {}

  @Get('summary')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  summary(@CurrentOrg('id') organizationId: string, @Query() q: UsageQueryDto) {
    const from = q.from ? new Date(q.from) : monthStart();
    const to = q.to ? new Date(q.to) : nextMonthStart();
    return this.service.summary(organizationId, from, to);
  }

  @Get('timeseries')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  timeseries(@CurrentOrg('id') organizationId: string, @Query() q: UsageQueryDto) {
    if (!q.channelId) {
      throw new BadRequestException('channelId é obrigatório');
    }
    const from = q.from ? new Date(q.from) : monthStart();
    const to = q.to ? new Date(q.to) : nextMonthStart();
    return this.service.timeseries(
      organizationId,
      q.channelId,
      from,
      to,
      q.bucket ?? 'day',
    );
  }

  /** Custo por mensagem (o que a Meta marca como cobrável), dia a dia. */
  @Get('billing')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  billing(@CurrentOrg('id') organizationId: string, @Query() q: RangeQueryDto) {
    const { from, to } = resolveUsageRange(q);
    return this.service.billing(organizationId, from, to);
  }

  /** Entrega das mensagens de saída dos canais oficiais, dia a dia. */
  @Get('delivery')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  delivery(@CurrentOrg('id') organizationId: string, @Query() q: RangeQueryDto) {
    const { from, to } = resolveUsageRange(q);
    return this.service.delivery(organizationId, from, to);
  }

  @Get('pricing')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  getPricing(@CurrentOrg('id') organizationId: string) {
    return this.service.getPricing(organizationId);
  }

  @Put('pricing')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  setPricing(@CurrentOrg('id') organizationId: string, @Body() body: SetPricingDto) {
    return this.service.setPricing(organizationId, body.currency ?? 'BRL', body.rates);
  }
}
