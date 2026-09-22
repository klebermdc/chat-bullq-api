import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser, CurrentUserRole, Feature } from '../../common/decorators';
import { resolveAssignmentScope } from '../messaging/conversations/conversation-scope';
import { TeamPresenceService } from './team-presence.service';

const DEFAULT_RANGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Feature('dashboard.view')
@Controller('dashboard')
export class TeamPresenceController {
  constructor(private readonly service: TeamPresenceService) {}

  @Get('team-presence')
  @ApiOperation({ summary: 'Equipe agora: status ao vivo e tempo online por atendente' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  getTeamPresence(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const now = new Date();
    const range = {
      from: from ? new Date(from) : new Date(now.getTime() - DEFAULT_RANGE_DAYS * DAY_MS),
      to: to ? new Date(to) : now,
    };
    // AGENT vê só a própria linha; OWNER/ADMIN veem a equipe (RN-05).
    return this.service.getTeamPresence(orgId, range, resolveAssignmentScope(role, userId));
  }
}
