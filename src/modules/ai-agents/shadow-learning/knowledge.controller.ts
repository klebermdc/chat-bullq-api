import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, Roles } from '../../../common/decorators';
import { KnowledgeService } from './knowledge.service';
import { HistoryScanService } from './history-scan.service';
import { ImportKnowledgeDto } from './dto/import-knowledge.dto';

@ApiTags('AI Agents — Knowledge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('ai-agents/:agentId/knowledge')
export class KnowledgeController {
  constructor(
    private readonly service: KnowledgeService,
    private readonly historyScan: HistoryScanService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista o conhecimento aprendido pelo agente (modo SHADOW)' })
  list(@CurrentOrg('id') orgId: string, @Param('agentId') agentId: string) {
    return this.service.list(orgId, agentId);
  }

  @Post('scan-history')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Dispara a varredura única do histórico guiamento' })
  scanHistory(@CurrentOrg('id') orgId: string, @Param('agentId') agentId: string) {
    return this.historyScan.scan(orgId, agentId);
  }

  @Post('import')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Importa FAQ curado (oficial) para a base do agente' })
  import(
    @CurrentOrg('id') orgId: string,
    @Param('agentId') agentId: string,
    @Body() dto: ImportKnowledgeDto,
  ) {
    return this.service.importCurated(orgId, agentId, dto.items);
  }
}
