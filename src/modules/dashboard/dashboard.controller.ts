import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ConversationStatus, OrgRole } from '@prisma/client';
import { DashboardService, LeadsFilter } from './dashboard.service';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser, CurrentUserRole } from '../../common/decorators';
import { resolveAssignmentScope } from '../messaging/conversations/conversation-scope';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  private parseRange(from?: string, to?: string) {
    const now = new Date();
    return {
      from: from ? new Date(from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      to: to ? new Date(to) : now,
    };
  }

  /**
   * Barreira de atribuição (RN-05): AGENT só vê métricas das próprias
   * conversas; OWNER/ADMIN veem a org inteira (undefined). Todo endpoint do
   * dashboard é AGENT-alcançável (o controller não tem @Roles), então cada
   * agregado escopa por este valor.
   */
  private assignmentScope(userId: string, role: OrgRole | undefined) {
    return resolveAssignmentScope(role, userId);
  }

  private parseLeadsFilter(
    from: string | undefined,
    to: string | undefined,
    channelId?: string,
    departmentId?: string,
    status?: string,
    assignedToId?: string,
  ): LeadsFilter {
    const range = this.parseRange(from, to);
    return {
      ...range,
      channelId: channelId || undefined,
      departmentId: departmentId || undefined,
      status: status ? (status as ConversationStatus) : undefined,
      assignedToId: assignedToId || undefined,
    };
  }

  @Get('overview')
  @ApiOperation({ summary: 'Get dashboard overview metrics' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'channelId', required: false }) @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'status', required: false }) @ApiQuery({ name: 'assignedToId', required: false })
  getOverview(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channelId') channelId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    const f = this.parseLeadsFilter(from, to, channelId, departmentId, status, assignedToId);
    return this.service.getOverview(
      orgId,
      this.parseRange(from, to),
      this.assignmentScope(userId, role),
      f,
    );
  }

  @Get('leads')
  @ApiOperation({ summary: 'Relatório de leads (novos, respondidos, por vendedor)' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'channelId', required: false }) @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'status', required: false }) @ApiQuery({ name: 'assignedToId', required: false })
  getLeads(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channelId') channelId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    return this.service.getLeadsReport(
      orgId,
      this.parseLeadsFilter(from, to, channelId, departmentId, status, assignedToId),
      this.assignmentScope(userId, role),
    );
  }

  @Get('volume-by-day')
  @ApiOperation({ summary: 'Conversations volume by day' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'channelId', required: false }) @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'status', required: false }) @ApiQuery({ name: 'assignedToId', required: false })
  getVolumeByDay(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channelId') channelId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    const f = this.parseLeadsFilter(from, to, channelId, departmentId, status, assignedToId);
    return this.service.getVolumeByDay(
      orgId,
      this.parseRange(from, to),
      this.assignmentScope(userId, role),
      f,
    );
  }

  @Get('volume-by-channel')
  @ApiOperation({ summary: 'Conversations volume by channel' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'channelId', required: false }) @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'status', required: false }) @ApiQuery({ name: 'assignedToId', required: false })
  getVolumeByChannel(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channelId') channelId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    const f = this.parseLeadsFilter(from, to, channelId, departmentId, status, assignedToId);
    return this.service.getVolumeByChannel(
      orgId,
      this.parseRange(from, to),
      this.assignmentScope(userId, role),
      f,
    );
  }

  @Get('volume-by-status')
  @ApiOperation({ summary: 'Conversations by status (current)' })
  @ApiQuery({ name: 'channelId', required: false }) @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'status', required: false }) @ApiQuery({ name: 'assignedToId', required: false })
  getVolumeByStatus(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('channelId') channelId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    const f = this.parseLeadsFilter(undefined, undefined, channelId, departmentId, status, assignedToId);
    return this.service.getVolumeByStatus(orgId, this.assignmentScope(userId, role), f);
  }

  @Get('kpi-sparklines')
  @ApiOperation({ summary: 'Daily series for hero KPIs (active, TMR, SLA, resolution)' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'channelId', required: false }) @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'status', required: false }) @ApiQuery({ name: 'assignedToId', required: false })
  getKpiSparklines(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channelId') channelId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    const f = this.parseLeadsFilter(from, to, channelId, departmentId, status, assignedToId);
    return this.service.getKpiSparklines(
      orgId,
      this.parseRange(from, to),
      this.assignmentScope(userId, role),
      f,
    );
  }

  @Get('agent-performance')
  @ApiOperation({ summary: 'Agent performance metrics' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'channelId', required: false }) @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'status', required: false }) @ApiQuery({ name: 'assignedToId', required: false })
  getAgentPerformance(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channelId') channelId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    const f = this.parseLeadsFilter(from, to, channelId, departmentId, status, assignedToId);
    return this.service.getAgentPerformance(
      orgId,
      this.parseRange(from, to),
      this.assignmentScope(userId, role),
      f,
    );
  }

  @Get('volume-flow')
  @ApiOperation({ summary: 'Conversations created vs closed per day' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'channelId', required: false }) @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'status', required: false }) @ApiQuery({ name: 'assignedToId', required: false })
  getVolumeFlow(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channelId') channelId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    const f = this.parseLeadsFilter(from, to, channelId, departmentId, status, assignedToId);
    return this.service.getVolumeFlow(
      orgId,
      this.parseRange(from, to),
      this.assignmentScope(userId, role),
      f,
    );
  }

  @Get('peak-hours')
  @ApiOperation({ summary: 'Conversation creation heatmap (day of week × hour)' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'channelId', required: false }) @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'status', required: false }) @ApiQuery({ name: 'assignedToId', required: false })
  getPeakHours(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channelId') channelId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    const f = this.parseLeadsFilter(from, to, channelId, departmentId, status, assignedToId);
    return this.service.getPeakHours(
      orgId,
      this.parseRange(from, to),
      this.assignmentScope(userId, role),
      f,
    );
  }

  @Get('messages-flow')
  @ApiOperation({ summary: 'Inbound vs outbound messages per day' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'channelId', required: false }) @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'status', required: false }) @ApiQuery({ name: 'assignedToId', required: false })
  getMessagesFlow(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channelId') channelId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    const f = this.parseLeadsFilter(from, to, channelId, departmentId, status, assignedToId);
    return this.service.getMessagesFlow(
      orgId,
      this.parseRange(from, to),
      this.assignmentScope(userId, role),
      f,
    );
  }

  @Get('bot-performance')
  @ApiOperation({ summary: 'Bot resolution vs human escalation breakdown' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'channelId', required: false }) @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'status', required: false }) @ApiQuery({ name: 'assignedToId', required: false })
  getBotPerformance(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channelId') channelId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    const f = this.parseLeadsFilter(from, to, channelId, departmentId, status, assignedToId);
    return this.service.getBotPerformance(
      orgId,
      this.parseRange(from, to),
      this.assignmentScope(userId, role),
      f,
    );
  }

  @Get('csat')
  @ApiOperation({ summary: 'CSAT breakdown (avg, distribution, recent comments)' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'channelId', required: false }) @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'status', required: false }) @ApiQuery({ name: 'assignedToId', required: false })
  getCsat(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channelId') channelId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    const f = this.parseLeadsFilter(from, to, channelId, departmentId, status, assignedToId);
    return this.service.getCsatBreakdown(
      orgId,
      this.parseRange(from, to),
      this.assignmentScope(userId, role),
      f,
    );
  }

  @Get('reopens')
  @ApiOperation({ summary: 'Conversation reopen tracking + worst offenders' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'channelId', required: false }) @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'status', required: false }) @ApiQuery({ name: 'assignedToId', required: false })
  getReopens(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channelId') channelId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    const f = this.parseLeadsFilter(from, to, channelId, departmentId, status, assignedToId);
    return this.service.getReopens(
      orgId,
      this.parseRange(from, to),
      this.assignmentScope(userId, role),
      f,
    );
  }

  @Get('top-tags')
  @ApiOperation({ summary: 'Top tags / conversation reasons' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'channelId', required: false }) @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'status', required: false }) @ApiQuery({ name: 'assignedToId', required: false })
  getTopTags(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('channelId') channelId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
  ) {
    const f = this.parseLeadsFilter(from, to, channelId, departmentId, status, assignedToId);
    return this.service.getTopTags(
      orgId,
      this.parseRange(from, to),
      this.assignmentScope(userId, role),
      f,
      limit ? parseInt(limit, 10) : 5,
    );
  }
}
