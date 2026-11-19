import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AiAgentKind, AiSkill, AiTool, OrgRole } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { LlmService } from '../../ai-agents/llm/llm.service';
import type { LlmMessage, LlmToolDefinition } from '../../ai-agents/llm/llm.types';
import { HttpToolExecutorService } from '../../ai-agents/tools/http-tool-executor.service';
import { ToolRegistry } from '../../ai-agents/tools/tool-registry.service';
import type { ToolContext } from '../../ai-agents/tools/tool.types';
import { MAIN_AGENT_SELECT, pickMainAgent } from '../../ai-agents/agents/main-agent';
import { ConversationAccessService } from '../../messaging/conversations/conversation-access.service';
import { messageText } from '../../messaging/messages/message-search';
import { formatFaq } from '../../mystery-shopper/bot/persona-generator';
import { PERSONA_FAQ_MAX_ROWS } from '../../mystery-shopper/bot/persona-generator.constants';
import { runCopilotToolLoop } from '../copilot-tool-loop';
import type { CopilotTurn } from '../copilot.service';
import {
  CONSULT_FAQ_MAX_CHARS,
  CONSULT_TRANSCRIPT_MAX_MESSAGES,
  buildConsultSystemPrompt,
  formatTranscript,
  isConsultSafeCustomSkill,
  pickConsultBuiltinTools,
  skillUsesConversationContext,
  splitSuggestion,
  type TranscriptMessage,
} from './consult-prompt';

export interface ConsultRequest {
  text: string;
  history?: CopilotTurn[];
  conversationId?: string;
  messageId?: string;
}
export interface ConsultUser {
  id: string;
  role?: OrgRole;
}
export interface ConsultReply {
  reply: string;
  suggestion: string | null;
}

type CustomSkill = AiSkill & { tool: AiTool };
type ConversationContext = { conversationId: string; contactId: string; channelId: string; contactName: string; transcript: string };

const HISTORY_TURNS = 10;
const TEMPERATURE = 0.3;
const MAX_TOKENS = 3000;
const NO_AGENT = 'A IA de atendimento ainda não está configurada nesta conta.';
const SENTINEL = 'copilot-consult';

/**
 * Copiloto no modo Consulta: responde o vendedor com o conhecimento da IA
 * principal (Aline) — prompt, contexto do momento, respostas aprendidas e as
 * ferramentas que só leem. Nunca envia nada ao cliente.
 */
@Injectable()
export class CopilotConsultService {
  private readonly logger = new Logger(CopilotConsultService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly registry: ToolRegistry,
    private readonly httpExec: HttpToolExecutorService,
    private readonly access: ConversationAccessService,
  ) {}

  async consult(organizationId: string, user: ConsultUser, req: ConsultRequest): Promise<ConsultReply> {
    // Acesso primeiro: conversa alheia responde 404 antes de qualquer custo de IA.
    const conversation = req.conversationId
      ? await this.loadConversation(organizationId, user, req.conversationId, req.messageId)
      : undefined;

    const agent = await this.loadMainAgent(organizationId);
    const [faq, customSkills] = await Promise.all([this.loadFaq(organizationId), this.loadCustomSkills(agent.id, !!conversation)]);

    const builtinDefs = pickConsultBuiltinTools(
      this.registry.getLlmDefinitionsForKind(agent.kind as AiAgentKind, agent.id),
      !!conversation,
    );
    const tools: LlmToolDefinition[] = [
      ...builtinDefs,
      ...customSkills.map((s) => ({ name: s.name, description: s.description, parameters: s.parameters as Record<string, unknown> })),
    ];

    const systemPrompt = buildConsultSystemPrompt({
      agentName: agent.name,
      agentPrompt: agent.systemPrompt,
      operationalContext: agent.operationalContext,
      faq,
      skillInstructions: customSkills.map((s) => s.promptInstructions?.trim() ?? '').filter(Boolean),
      conversation,
    });
    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...(req.history ?? []).slice(-HISTORY_TURNS).map((t): LlmMessage => ({ role: t.role, content: t.content })),
      { role: 'user', content: req.text },
    ];

    const ctx: ToolContext = {
      organizationId,
      agentId: agent.id,
      conversationId: conversation?.conversationId ?? SENTINEL,
      contactId: conversation?.contactId ?? SENTINEL,
      channelId: conversation?.channelId ?? SENTINEL,
      runId: SENTINEL,
    };
    const builtinNames = new Set(builtinDefs.map((d) => d.name));
    const customByName = new Map(customSkills.map((s) => [s.name, s]));

    const text = await runCopilotToolLoop(
      this.llm,
      { organizationId, modelId: agent.modelId, tools: tools.length ? tools : undefined, temperature: TEMPERATURE, maxTokens: MAX_TOKENS },
      messages,
      async (name, args) => {
        if (builtinNames.has(name)) return (await this.registry.get(name).execute(args, ctx)).output;
        const skill = customByName.get(name);
        if (skill) return (await this.httpExec.execute(skill, skill.tool, args, ctx)).output;
        // Fora da lista fechada (ex.: o modelo tentou responder ao cliente): recusa.
        return { ok: false, error: `Ferramenta indisponível no modo consulta: ${name}` };
      },
    );
    this.logger.log(`copilot_consult org=${organizationId} user=${user.id} conv=${conversation?.conversationId ?? '-'} tools=${tools.length}`);
    return splitSuggestion(text);
  }

  private async loadMainAgent(organizationId: string) {
    const agents = await this.prisma.aiAgent.findMany({
      where: { organizationId, isActive: true, deletedAt: null },
      select: { ...MAIN_AGENT_SELECT, modelId: true },
    });
    const agent = pickMainAgent(agents);
    if (!agent) throw new BadRequestException(NO_AGENT);
    return agent;
  }

  private async loadFaq(organizationId: string): Promise<string> {
    try {
      const rows = await this.prisma.aiAgentKnowledge.findMany({
        where: { organizationId, question: { not: null }, agent: { isActive: true, deletedAt: null } },
        orderBy: [{ occurrences: 'desc' }, { updatedAt: 'desc' }],
        take: PERSONA_FAQ_MAX_ROWS,
        select: { question: true, content: true, category: true },
      });
      return formatFaq(rows, CONSULT_FAQ_MAX_CHARS);
    } catch (err) {
      // Sem as respostas aprendidas o Copiloto ainda responde com o prompt.
      this.logger.warn(`copilot_consult_faq_failed org=${organizationId}: ${(err as Error).message}`);
      return '';
    }
  }

  private async loadCustomSkills(agentId: string, hasConversation: boolean): Promise<CustomSkill[]> {
    // Skill que pede aprovação viraria um item falso na fila de aprovação: fica de fora.
    const links = await this.prisma.aiAgentSkill.findMany({
      where: { agentId, requiresApproval: false },
      include: { skill: { include: { tool: true } } },
    });
    return links
      .map((l) => l.skill)
      .filter((s): s is CustomSkill => !!s.tool && s.isActive && !s.deletedAt && s.tool.isActive && !s.tool.deletedAt)
      .filter((s) => isConsultSafeCustomSkill(s))
      .filter(
        (s) =>
          hasConversation ||
          !skillUsesConversationContext([s.httpPath, s.httpHeadersExtra, s.httpBodyTemplate, s.tool.httpBaseUrl, s.tool.httpHeaders]),
      );
  }

  private async loadConversation(
    organizationId: string,
    user: ConsultUser,
    conversationId: string,
    messageId?: string,
  ): Promise<ConversationContext> {
    // Mesma trava das telas: vendedor só alcança a conversa dele ou a compartilhada com ele.
    const conv = await this.access.assertConversationAccess(conversationId, organizationId, user.role, user.id, {
      allowParticipant: true,
    });
    const select = { id: true, direction: true, senderName: true, content: true, createdAt: true } as const;
    const [contact, recent] = await Promise.all([
      this.prisma.contact.findUnique({ where: { id: conv.contactId }, select: { name: true, phone: true } }),
      this.prisma.message.findMany({
        where: { conversationId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        take: CONSULT_TRANSCRIPT_MAX_MESSAGES,
        select,
      }),
    ]);
    const messages = [...recent].reverse();
    // Mensagem clicada fora da janela recente: entra mesmo assim, no começo.
    if (messageId && !messages.some((m) => m.id === messageId)) {
      const focus = await this.prisma.message.findFirst({ where: { id: messageId, conversationId, revokedAt: null }, select });
      if (focus) messages.unshift(focus);
    }
    const transcriptMessages: TranscriptMessage[] = messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      senderName: m.senderName,
      text: messageText(m.content),
      createdAt: m.createdAt,
    }));
    const contactName = contact?.name?.trim() || contact?.phone || 'cliente';
    return {
      conversationId: conv.id,
      contactId: conv.contactId,
      channelId: conv.channelId,
      contactName,
      transcript: formatTranscript(transcriptMessages, contactName, messageId),
    };
  }
}
