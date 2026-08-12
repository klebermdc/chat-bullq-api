import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, Feature } from '../../../common/decorators';
import { PrismaService } from '../../../database/prisma.service';
import { EvalRunnerService } from './runner.service';
import { EvalReporterService } from './reporter.service';
import { datasets } from './datasets';
import { EvalCase, EvalRunReport } from './types';

interface RunEvalsBody {
  /**
   * Nome do dataset (= nome canônico do agent, ex: "Daniel Souza"). Quando
   * fornecido, ignora `cases` e carrega o dataset de `evals/datasets/*`.
   */
  datasetName?: string;
  /**
   * Cases inline para casos ad-hoc / quickfire. Ignorado se `datasetName`
   * vier preenchido. Quando ambos vierem vazios, o controller tenta
   * resolver o dataset pelo NOME do agent identificado por `id`.
   */
  cases?: EvalCase[];
}

interface RunEvalsResponse {
  report: EvalRunReport;
  reportPath: string;
}

/**
 * Endpoint operacional pra rodar uma suíte de evals contra um agent.
 * Retorna o relatório em memória + o path do markdown gravado em /tmp.
 */
@ApiTags('AI Agents - Evals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Feature('ai-agents.view')
@Controller('agents/:id/evals')
export class EvalsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: EvalRunnerService,
    private readonly reporter: EvalReporterService,
  ) {}

  @Post('run')
  @ApiOperation({
    summary:
      'Run an eval dataset against the given agent. Returns the markdown report path + structured report.',
  })
  async run(
    @Param('id') agentId: string,
    @CurrentOrg('id') organizationId: string,
    @Body() body: RunEvalsBody,
  ): Promise<RunEvalsResponse> {
    // findFirst com a org no `where`, NÃO findUnique por id: a busca só por id
    // deixava qualquer usuário autenticado rodar o agent de outra empresa —
    // gastando o token dela e lendo o comportamento do agent pelo relatório.
    const agent = await this.prisma.aiAgent.findFirst({
      where: { id: agentId, organizationId, deletedAt: null },
    });
    if (!agent) {
      throw new NotFoundException(`Agent ${agentId} not found`);
    }

    const datasetName = body?.datasetName ?? agent.name;
    const inlineCases = body?.cases ?? [];

    let cases: EvalCase[];
    let resolvedDatasetLabel: string;

    if (inlineCases.length > 0 && !body?.datasetName) {
      // ad-hoc inline run (used by frontend "test these cases now" tooling)
      cases = inlineCases;
      resolvedDatasetLabel = 'inline';
    } else {
      const dataset = datasets[datasetName];
      if (!dataset) {
        throw new BadRequestException(
          `Dataset "${datasetName}" not found. Available: [${Object.keys(datasets).join(', ')}]`,
        );
      }
      cases = dataset.cases;
      resolvedDatasetLabel = datasetName;
    }

    const results = [];
    for (const c of cases) {
      const result = await this.runner.runCase(
        c,
        agent.name,
        agent.organizationId,
      );
      results.push(result);
    }

    const report = this.reporter.buildReport({
      agentName: agent.name,
      datasetName: resolvedDatasetLabel,
      results,
    });
    const reportPath = await this.reporter.writeMarkdown(report);

    return { report, reportPath };
  }
}
