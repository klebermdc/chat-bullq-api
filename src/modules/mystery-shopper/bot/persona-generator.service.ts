import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { LlmService } from '../../ai-agents/llm/llm.service';
import { SAKANA_CONVERSATION_MODEL } from '../../ai-agents/llm/llm.constants';
import type { LlmContent } from '../../ai-agents/llm/llm.types';
import { REAL_CONVERSATION } from '../../../common/mystery-shopper.filters';
import { LOST_REASONS } from '../../pipelines/lost-sale.constants';
import {
  PERSONA_AGENT_MAX_CHARS,
  PERSONA_FAQ_MAX_ROWS,
  PERSONA_LOST_REASONS_MAX,
  PERSONA_LOST_WINDOW_DAYS,
  PERSONA_MAX_ATTEMPTS,
  PERSONA_MAX_TOKENS,
  PERSONA_TEMPERATURE,
} from './persona-generator.constants';
import {
  buildPersonaPrompt,
  capText,
  formatFaq,
  formatLostReasons,
  parsePersona,
  type FaqRow,
  type LostReasonCount,
  type PersonaContext,
} from './persona-generator';
import {
  MAIN_AGENT_SELECT,
  pickMainAgent,
  type AgentCandidate,
} from '../../ai-agents/agents/main-agent';

export { pickMainAgent, type AgentCandidate };

const FRIENDLY_ERROR = 'Não foi possível criar a persona agora. Tente de novo.';
const RETRY_REMINDER =
  'A tentativa anterior veio ilegível, vazia ou com outro idioma. Responda só o JSON pedido, em português do Brasil.';
const DAY_MS = 86_400_000;

function llmText(content: LlmContent): string {
  if (typeof content === 'string') return content;
  return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}


/** Escreve a persona do cliente oculto a partir de uma prévia, com o conhecimento da própria org. */
@Injectable()
export class PersonaGeneratorService {
  private readonly logger = new Logger(PersonaGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  async generate(organizationId: string, brief: string, now: Date = new Date()): Promise<{ persona: string }> {
    const context = await this.loadContext(organizationId, now);
    const prompt = buildPersonaPrompt(brief, context);
    const persona = await this.ask(organizationId, prompt);
    if (!persona) throw new ServiceUnavailableException(FRIENDLY_ERROR);
    return { persona };
  }

  /** Cada fonte é opcional: falha numa delas vira "(sem dados)", não derruba a geração. */
  private async loadContext(organizationId: string, now: Date): Promise<PersonaContext> {
    const [faq, agentInstructions, lostReasons] = await Promise.all([
      this.safe('faq', () => this.loadFaq(organizationId)),
      this.safe('agent', () => this.loadAgentInstructions(organizationId)),
      this.safe('lost_reasons', () => this.loadLostReasons(organizationId, now)),
    ]);
    return { faq, agentInstructions, lostReasons };
  }

  private async safe(source: string, load: () => Promise<string>): Promise<string> {
    try {
      return await load();
    } catch (err) {
      this.logger.warn(`persona_context_failed source=${source}: ${(err as Error).message}`);
      return '';
    }
  }

  private async loadFaq(organizationId: string): Promise<string> {
    const rows: FaqRow[] = await this.prisma.aiAgentKnowledge.findMany({
      where: { organizationId, question: { not: null }, agent: { isActive: true, deletedAt: null } },
      orderBy: [{ occurrences: 'desc' }, { updatedAt: 'desc' }],
      take: PERSONA_FAQ_MAX_ROWS,
      select: { question: true, content: true, category: true },
    });
    return formatFaq(rows);
  }

  private async loadAgentInstructions(organizationId: string): Promise<string> {
    const agents: AgentCandidate[] = await this.prisma.aiAgent.findMany({
      where: { organizationId, isActive: true, deletedAt: null },
      select: MAIN_AGENT_SELECT,
    });
    const agent = pickMainAgent(agents);
    if (!agent) return '';
    const parts = [agent.systemPrompt.trim(), agent.operationalContext?.trim() ? `Contexto do momento: ${agent.operationalContext.trim()}` : ''];
    return capText(parts.filter(Boolean).join('\n\n'), PERSONA_AGENT_MAX_CHARS);
  }

  private async loadLostReasons(organizationId: string, now: Date): Promise<string> {
    const since = new Date(now.getTime() - PERSONA_LOST_WINDOW_DAYS * DAY_MS);
    const groups = await this.prisma.conversation.groupBy({
      by: ['lostReason'],
      where: { organizationId, deletedAt: null, ...REAL_CONVERSATION, lostAt: { gte: since }, lostReason: { not: null } },
      _count: { _all: true },
    });
    const rows: LostReasonCount[] = groups
      .map((g) => ({
        reason: LOST_REASONS[g.lostReason as keyof typeof LOST_REASONS] ?? g.lostReason ?? 'Sem motivo',
        count: g._count._all,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, PERSONA_LOST_REASONS_MAX);
    return formatLostReasons(rows);
  }

  /** Até 2 tentativas; erro da IA, JSON ilegível, vazio ou outro alfabeto contam como tentativa perdida. */
  private async ask(organizationId: string, prompt: { system: string; user: string }): Promise<string | null> {
    for (let attempt = 0; attempt < PERSONA_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.llm.complete({
          organizationId,
          modelId: SAKANA_CONVERSATION_MODEL,
          temperature: PERSONA_TEMPERATURE,
          maxTokens: PERSONA_MAX_TOKENS,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: attempt === 0 ? prompt.user : `${prompt.user}\n\n${RETRY_REMINDER}` },
          ],
        });
        const text = llmText(response.message.content);
        const persona = parsePersona(text);
        if (persona) {
          this.logger.log(`persona_generated org=${organizationId} attempt=${attempt} chars=${persona.length} costUsd=${response.usage.costUsd}`);
          return persona;
        }
        this.logger.warn(`persona_unreadable org=${organizationId} attempt=${attempt} stop=${response.stopReason ?? '?'} chars=${text.length}`);
      } catch (err) {
        this.logger.warn(`persona_llm_error org=${organizationId} attempt=${attempt}: ${(err as Error).message}`);
      }
    }
    return null;
  }
}
