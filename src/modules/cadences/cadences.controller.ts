import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, Roles } from '../../common/decorators';
import { CadencesService } from './cadences.service';
import { CadenceRunner } from './cadence-runner.service';
import { EnrollmentsRepository } from './enrollments.repository';
import { UpsertCadenceDto } from './dto/upsert-cadence.dto';

@ApiTags('Cadences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('cadences')
export class CadencesController {
  constructor(
    private readonly service: CadencesService,
    private readonly runner: CadenceRunner,
    private readonly enrollments: EnrollmentsRepository,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista as cadências da organização' })
  list(@CurrentOrg('id') orgId: string) {
    return this.service.list(orgId);
  }

  @Get('template/default')
  @ApiOperation({
    summary: 'Template padrão não-persistido (4 textos) para o editor',
  })
  getDefaultTemplate(@CurrentOrg('id') orgId: string) {
    return this.service.getDefaultTemplate(orgId);
  }

  @Get('enrollments/active/:conversationId')
  async activeEnrollment(
    @Param('conversationId') conversationId: string,
    @CurrentOrg('id') orgId: string,
  ) {
    // `findLive`, não `findActive`: um enrollment PAUSED (revive armado) segue
    // vivo e precisa aparecer no selo — senão o atendente vê a cadência sumir
    // do header e conclui que ela morreu depois de um "vou pensar".
    const e = await this.enrollments.findLiveWithCadence(conversationId);
    if (!e || e.organizationId !== orgId) return { active: false };
    return {
      active: true,
      enrollmentId: e.id,
      status: e.status,
      paused: e.status === 'PAUSED',
      pausedAt: e.pausedAt,
      // Retomada estimada: a janela de silêncio contada a partir da pausa. É
      // uma previsão — o watchdog rearma a cada mensagem nova na conversa.
      resumesAt:
        e.status === 'PAUSED' && e.pausedAt
          ? new Date(
              new Date(e.pausedAt).getTime() +
                (e.cadence.silenceWindowMinutes ?? 1440) * 60_000,
            )
          : null,
      currentStep: e.currentStep,
      totalSteps: e.cadence.steps.length,
      cadenceName: e.cadence.name,
      trigger: e.cadence.trigger,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Carrega uma cadência por id' })
  get(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.get(orgId, id);
  }

  @Post()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Cria uma cadência' })
  create(@Body() dto: UpsertCadenceDto, @CurrentOrg('id') orgId: string) {
    return this.service.upsert(orgId, dto);
  }

  @Put(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Atualiza uma cadência' })
  update(
    @Param('id') id: string,
    @Body() dto: UpsertCadenceDto,
    @CurrentOrg('id') orgId: string,
  ) {
    return this.service.upsert(orgId, dto, id);
  }

  @Delete(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Remove uma cadência' })
  remove(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.remove(orgId, id);
  }

  @Post('enrollments/:enrollmentId/stop')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.AGENT)
  @ApiOperation({ summary: 'Encerra manualmente um enrollment (handoff)' })
  stopEnrollment(
    @Param('enrollmentId') enrollmentId: string,
    @CurrentOrg('id') orgId: string,
  ) {
    return this.runner.stop(enrollmentId, 'manual_handoff', orgId);
  }

  @Post('enrollments/:enrollmentId/resume')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.AGENT)
  @ApiOperation({
    summary: 'Retoma agora um enrollment PAUSED (sem esperar o watchdog)',
  })
  async resumeEnrollment(
    @Param('enrollmentId') enrollmentId: string,
    @CurrentOrg('id') orgId: string,
  ) {
    await this.runner.resumeNow(enrollmentId, orgId);
    return { resumed: true };
  }

  @Post(':id/start')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.AGENT)
  @ApiOperation({ summary: 'Inicia manualmente a cadência numa conversa' })
  start(
    @Param('id') id: string,
    @Body('conversationId') conversationId: string,
    @CurrentOrg('id') orgId: string,
  ) {
    return this.runner.start(conversationId, id, 'MANUAL', orgId);
  }
}
