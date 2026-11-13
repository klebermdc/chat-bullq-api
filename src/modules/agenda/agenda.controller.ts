import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser, CurrentUserRole } from '../../common/decorators';
import { AgendaService } from './agenda.service';
import {
  CreateAppointmentDto,
  FreeSlotsQueryDto,
  ListAgendaQueryDto,
  RescheduleAppointmentDto,
  SetAppointmentStatusDto,
} from './dto/agenda.dto';

@ApiTags('Agenda')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('agenda')
export class AgendaController {
  constructor(private readonly service: AgendaService) {}

  @Get()
  @ApiOperation({ summary: 'Compromissos do período (atendente: só os próprios)' })
  list(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Query() q: ListAgendaQueryDto,
  ) {
    return this.service.list(orgId, { userId, role }, q);
  }

  @Get('free-slots')
  @ApiOperation({ summary: 'Próximos horários livres do vendedor' })
  async freeSlots(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Query() q: FreeSlotsQueryDto,
  ) {
    const isManager = role === OrgRole.OWNER || role === OrgRole.ADMIN;
    const ownerUserId = isManager ? q.ownerUserId ?? userId : userId;
    return { ownerUserId, slots: await this.service.freeSlots(orgId, ownerUserId, { count: q.count }) };
  }

  @Post()
  @ApiOperation({ summary: 'Marcar compromisso' })
  create(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Body() dto: CreateAppointmentDto,
  ) {
    return this.service.create(orgId, { userId, role }, dto);
  }

  @Patch(':id/reschedule')
  @ApiOperation({ summary: 'Remarcar' })
  reschedule(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Body() dto: RescheduleAppointmentDto,
  ) {
    return this.service.reschedule(orgId, { userId, role }, id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Feito, cancelado ou não atendeu' })
  setStatus(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Body() dto: SetAppointmentStatusDto,
  ) {
    return this.service.setStatus(orgId, { userId, role }, id, dto.status);
  }
}
