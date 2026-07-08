import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg } from '../../../common/decorators';
import { KnowledgeService } from './knowledge.service';

@ApiTags('AI Agents — Knowledge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('ai-agents/:agentId/knowledge')
export class KnowledgeController {
  constructor(private readonly service: KnowledgeService) {}

  @Get()
  @ApiOperation({ summary: 'Lista o conhecimento aprendido pelo agente (modo SHADOW)' })
  list(@CurrentOrg('id') orgId: string, @Param('agentId') agentId: string) {
    return this.service.list(orgId, agentId);
  }
}
