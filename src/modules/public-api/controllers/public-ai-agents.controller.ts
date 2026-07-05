import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../../../common/guards';
import { CurrentOrg } from '../../../common/decorators';
import { ApiKeyThrottleGuard } from '../guards/api-key-throttle.guard';
import { PublicAiAgentsService } from '../ai-agents/public-ai-agents.service';
import { mapAiAgent } from '../mappers/ai-agent.mapper';
import { mapAiAgentRun } from '../mappers/ai-agent-run.mapper';
import { ListAgentRunsPublicDto } from '../dto/list-agent-runs.public.dto';

@ApiTags('Public API · AI Agents')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottleGuard)
@Controller('public/ai-agents')
export class PublicAiAgentsController {
  constructor(private readonly service: PublicAiAgentsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os agentes de IA da organização' })
  async list(@CurrentOrg('id') orgId: string) {
    const agents = await this.service.list(orgId);
    return { items: agents.map(mapAiAgent) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha um agente de IA' })
  async get(@CurrentOrg('id') orgId: string, @Param('id') id: string) {
    return mapAiAgent(await this.service.findOne(orgId, id));
  }

  @Get(':id/runs')
  @ApiOperation({ summary: 'Histórico de execuções do agente (mais recentes)' })
  async runs(@CurrentOrg('id') orgId: string, @Param('id') id: string, @Query() q: ListAgentRunsPublicDto) {
    const runs = await this.service.listRuns(orgId, id, q.limit);
    return { items: runs.map(mapAiAgentRun) };
  }
}
