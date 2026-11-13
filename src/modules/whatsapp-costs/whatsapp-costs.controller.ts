import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { CurrentOrg, Roles } from '../../common/decorators';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { BreakdownQueryDto, CostsQueryDto } from './dto/costs-query.dto';
import { WhatsappCostsService } from './whatsapp-costs.service';

@ApiTags('whatsapp-costs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('whatsapp-costs')
export class WhatsappCostsController {
  constructor(private readonly service: WhatsappCostsService) {}

  @Get()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  costs(@CurrentOrg('id') organizationId: string, @Query() q: CostsQueryDto) {
    return this.service.getCosts(organizationId, new Date(), q.from, q.to);
  }

  @Get('breakdown')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  breakdown(@CurrentOrg('id') organizationId: string, @Query() q: BreakdownQueryDto) {
    return this.service.getBreakdown(organizationId, q.channelId, new Date(), q.from, q.to);
  }
}
