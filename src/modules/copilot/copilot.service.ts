import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AiSkill, AiTool } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { LlmService } from '../ai-agents/llm/llm.service';
import { HttpToolExecutorService } from '../ai-agents/tools/http-tool-executor.service';
import { SqlToolExecutorService } from '../ai-agents/tools/sql-tool-executor.service';
import type {
  LlmMessage,
  LlmToolDefinition,
} from '../ai-agents/llm/llm.types';
import { runCopilotToolLoop } from './copilot-tool-loop';
import type { ToolContext } from '../ai-agents/tools/tool.types';

export type CopilotTurn = { role: 'user' | 'assistant'; content: string };

@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly httpExec: HttpToolExecutorService,
    private readonly sqlExec: SqlToolExecutorService,
  ) {}

  async ask(
    organizationId: string,
    text: string,
    history: CopilotTurn[] = [],
  ): Promise<{ reply: string }> {
    const agent = await this.prisma.aiAgent.findFirst({
      where: {
        organizationId,
        category: 'copiloto-interno',
        isActive: true,
        deletedAt: null,
      },
    });
    if (!agent) {
      throw new BadRequestException(
        'O Copiloto ainda não está configurado nesta conta.',
      );
    }

    // Skills do agente → tool defs + mapa de dispatch (só custom HTTP/SQL).
    const skillLinks = await this.prisma.aiAgentSkill.findMany({
      where: { agentId: agent.id },
      include: { skill: { include: { tool: true } } },
    });
    const skillsByName = new Map<string, AiSkill & { tool: AiTool | null }>();
    const tools: LlmToolDefinition[] = [];
    const skillInstructions: string[] = [];
    for (const link of skillLinks) {
      const skill = link.skill as AiSkill & { tool: AiTool | null };
      if (!skill.isActive || skill.deletedAt || !skill.tool) continue;
      if (skill.source === 'BUILTIN') continue;
      skillsByName.set(skill.name, skill);
      tools.push({
        name: skill.name,
        description: skill.description,
        parameters: skill.parameters as Record<string, unknown>,
      });
      if (skill.promptInstructions) {
        skillInstructions.push(skill.promptInstructions.trim());
      }
    }

    const systemPrompt = [agent.systemPrompt, ...skillInstructions]
      .filter(Boolean)
      .join('\n\n');
    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history
        .slice(-10)
        .map((t): LlmMessage => ({ role: t.role, content: t.content })),
      { role: 'user', content: text },
    ];

    // Não há conversa real: preenchemos organizationId/agentId reais e
    // sentinelas nos campos que as skills atuais não leem.
    const ctx: ToolContext = {
      organizationId,
      agentId: agent.id,
      conversationId: 'copilot',
      contactId: 'copilot',
      channelId: 'copilot',
      runId: 'copilot',
    };

    const reply = await runCopilotToolLoop(
      this.llm,
      {
        organizationId,
        modelId: agent.modelId,
        tools: tools.length ? tools : undefined,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
      },
      messages,
      async (name, args) => {
        const skill = skillsByName.get(name);
        if (!skill || !skill.tool) {
          return { ok: false, error: `Skill desconhecida: ${name}` };
        }
        const result =
          skill.source === 'SQL'
            ? await this.sqlExec.execute(skill, skill.tool, args, ctx)
            : await this.httpExec.execute(skill, skill.tool, args, ctx);
        return result.output;
      },
    );
    return { reply };
  }
}
