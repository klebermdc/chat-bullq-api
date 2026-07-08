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
import { UpsertCadenceDto } from './dto/upsert-cadence.dto';

@ApiTags('Cadences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('cadences')
export class CadencesController {
  constructor(
    private readonly service: CadencesService,
    private readonly runner: CadenceRunner,
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
  stopEnrollment(@Param('enrollmentId') enrollmentId: string) {
    return this.runner.stop(enrollmentId, 'manual_handoff');
  }

  @Post(':id/start')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.AGENT)
  @ApiOperation({ summary: 'Inicia manualmente a cadência numa conversa' })
  start(
    @Param('id') id: string,
    @Body('conversationId') conversationId: string,
    @CurrentOrg('id') _orgId: string,
  ) {
    return this.runner.start(conversationId, id, 'MANUAL');
  }
}
