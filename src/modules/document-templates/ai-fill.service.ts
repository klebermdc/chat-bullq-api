import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { LlmService } from '../ai-agents/llm/llm.service';
import { SAKANA_CONVERSATION_MODEL } from '../ai-agents/llm/llm.constants';
import type { LlmContent } from '../ai-agents/llm/llm.types';
import { stripThinkBlocks } from '../ai-agents/runner/text-guards';
import { NON_CONVERSATIONAL_TYPES } from '../attendant-diary/diary.constants';
import {
  ConversationActor,
  ConversationGuardService,
} from '../acceptances/conversation-guard.service';
import { DocumentTemplatesService } from './document-templates.service';
import { extractPlaceholders, normalizeValues } from './placeholders.util';
import { computeExtensoFields } from './money-words.util';
import {
  AI_FILL_MAX_MESSAGES,
  SourceMessage,
  aiTargetFields,
  buildAiFillPrompt,
  buildSource,
  conversationLines,
  extractFirstJsonObject,
  sanitizeAiValues,
} from './ai-fill.util';

export interface AiFillInput {
  conversationId?: string;
  text?: string;
  useConversation?: boolean;
  currentValues?: Record<string, string>;
}

export interface AiFillResult {
  values: Record<string, string>;
  /** Campos devolvidos (IA + extensos calculados). */
  filled: string[];
}

export const AI_FILL_NO_SOURCE = 'Cole um texto ou use a conversa para preencher com IA.';
export const AI_FILL_FAILED = 'Não foi possível preencher com IA agora. Tente de novo em instantes.';

/** Resposta curta: só um JSON de campos — mas o MiniMax pensa antes (<think>). */
const AI_FILL_MAX_TOKENS = 6000;

function contentToText(content: LlmContent): string {
  if (typeof content === 'string') return content;
  return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

/**
 * "Preencher com IA": lê o texto colado e/ou a conversa e devolve só os
 * campos que estão escritos ali. Extenso de valor é calculado em código,
 * nunca pela IA. Não loga texto nem valores — só ids e contagens.
 */
@Injectable()
export class AiFillService {
  private readonly logger = new Logger(AiFillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly templates: DocumentTemplatesService,
    private readonly guard: ConversationGuardService,
  ) {}

  async fill(actor: ConversationActor, templateId: string, input: AiFillInput): Promise<AiFillResult> {
    const pasted = (input.text ?? '').trim();
    const readConversation = Boolean(input.conversationId && input.useConversation);
    if (!pasted && !readConversation) throw new BadRequestException(AI_FILL_NO_SOURCE);

    const template = await this.templates.findVisible(actor, templateId);
    if (input.conversationId) await this.guard.assertCanUse(actor, input.conversationId);

    const placeholders = extractPlaceholders(template.body);
    const current = normalizeValues(input.currentValues);
    const targets = aiTargetFields(placeholders, current);
    const lines = readConversation ? await this.conversationLines(input.conversationId as string) : [];
    const source = buildSource({ pasted, lines });

    const fromAi = targets.length > 0 && source
      ? await this.ask(actor.organizationId, template.id, { title: template.title, fields: targets, source })
      : {};
    const extenso = computeExtensoFields(placeholders, { ...current, ...fromAi });
    const freshExtenso = Object.fromEntries(
      Object.entries(extenso).filter(([key]) => !(current[key] ?? '').trim()),
    );
    const values = { ...fromAi, ...freshExtenso };
    const filled = Object.keys(values);
    this.logger.log(
      `ai_fill template=${template.id} conv=${input.conversationId ?? '-'} asked=${targets.length} filled=${filled.length} lines=${lines.length}`,
    );
    return { values, filled };
  }

  private async conversationLines(conversationId: string): Promise<string[]> {
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        revokedAt: null,
        type: { notIn: [...NON_CONVERSATIONAL_TYPES] },
      },
      orderBy: { createdAt: 'desc' },
      take: AI_FILL_MAX_MESSAGES,
      select: { direction: true, content: true, metadata: true },
    });
    const ordered = [...rows].reverse() as SourceMessage[];
    return conversationLines(ordered);
  }

  private async ask(
    organizationId: string,
    templateId: string,
    prompt: { title: string; fields: string[]; source: string },
  ): Promise<Record<string, string>> {
    const { system, user } = buildAiFillPrompt(prompt);
    let raw: string;
    try {
      const response = await this.llm.complete({
        organizationId,
        modelId: SAKANA_CONVERSATION_MODEL,
        temperature: 0,
        maxTokens: AI_FILL_MAX_TOKENS,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      raw = stripThinkBlocks(contentToText(response.message.content));
    } catch (err) {
      this.logger.warn(`ai_fill_llm_failed template=${templateId}: ${(err as Error)?.name ?? 'erro'}`);
      throw new BadGatewayException(AI_FILL_FAILED);
    }
    const parsed = extractFirstJsonObject(raw);
    if (!parsed) {
      this.logger.warn(`ai_fill_unreadable template=${templateId} chars=${raw.length}`);
      throw new BadGatewayException(AI_FILL_FAILED);
    }
    return sanitizeAiValues(parsed, prompt.fields);
  }
}
