import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AiSkill, AiTool } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { LlmService } from '../ai-agents/llm/llm.service';
import { HttpToolExecutorService } from '../ai-agents/tools/http-tool-executor.service';
import { SqlToolExecutorService } from '../ai-agents/tools/sql-tool-executor.service';
import {
  stripForeignScripts,
  stripThinkBlocks,
} from '../ai-agents/runner/text-guards';
import type {
  LlmContent,
  LlmMessage,
  LlmTextPart,
  LlmToolDefinition,
} from '../ai-agents/llm/llm.types';
import type { ToolContext } from '../ai-agents/tools/tool.types';

export type CopilotTurn = { role: 'user' | 'assistant'; content: string };

@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);
  private static readonly MAX_ITERATIONS = 5;

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

    for (let i = 0; i < CopilotService.MAX_ITERATIONS; i++) {
      const res = await this.llm.complete({
        organizationId,
        modelId: agent.modelId,
        messages,
        tools: tools.length ? tools : undefined,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
      });
      messages.push(res.message);

      if (res.stopReason !== 'tool_calls' || !res.message.toolCalls?.length) {
        const reply = this.clean(this.textOf(res.message.content));
        return { reply: reply || 'Não consegui gerar uma resposta agora.' };
      }

      for (const call of res.message.toolCalls) {
        const skill = skillsByName.get(call.name);
        let output: unknown;
        if (!skill || !skill.tool) {
          output = { ok: false, error: `Skill desconhecida: ${call.name}` };
        } else {
          try {
            const result =
              skill.source === 'SQL'
                ? await this.sqlExec.execute(
                    skill,
                    skill.tool,
                    call.arguments,
                    ctx,
                  )
                : await this.httpExec.execute(
                    skill,
                    skill.tool,
                    call.arguments,
                    ctx,
                  );
            output = result.output;
          } catch (err: any) {
            output = { ok: false, error: err?.message ?? String(err) };
          }
        }
        messages.push({
          role: 'tool',
          content: JSON.stringify(output),
          toolCallId: call.id,
          name: call.name,
        });
      }
    }

    const last = [...messages].reverse().find((m) => m.role === 'assistant');
    return {
      reply: last
        ? this.clean(this.textOf(last.content)) ||
          'Não consegui concluir a consulta.'
        : 'Não consegui concluir a consulta.',
    };
  }

  /** Remove raciocínio `<think>` e caracteres CJK vazados antes de devolver. */
  private clean(text: string): string {
    return stripForeignScripts(stripThinkBlocks(text));
  }

  private textOf(content: LlmContent): string {
    if (typeof content === 'string') return content;
    return content
      .filter((p): p is LlmTextPart => p.type === 'text')
      .map((p) => p.text)
      .join('');
  }
}
