import { Inject, Injectable, Logger } from '@nestjs/common';
import { SAKANA_CONVERSATION_MODEL } from '../../ai-agents/llm/llm.constants';
import { LlmService } from '../../ai-agents/llm/llm.service';
import type { LlmContent, LlmMessage } from '../../ai-agents/llm/llm.types';
import { stripThinkBlocks } from '../../ai-agents/runner/text-guards';
import type { AlertOrg } from '../../response-sla/manager-alerts/manager-alerts.repository';
import { buildSystemPrompt, LLM_DOWN, NO_ANSWER } from './assistant.prompt';
import { ASSISTANT_TOOLS, AssistantTools } from './assistant.tools';

/** Rodadas de ferramenta por pergunta antes de desistir. */
export const MAX_TOOL_ROUNDS = 5;
/** Trocas (pergunta + resposta) lembradas por chat. */
export const HISTORY_TURNS = 10;
const HISTORY_TTL_SECONDS = 24 * 60 * 60;
const MAX_TOKENS = 1500;
const TEMPERATURE = 0.2;
export const MANAGER_BOT_HISTORY = 'MANAGER_BOT_HISTORY';

/** Subconjunto do ioredis usado na memória curta (o cliente do BullMQ serve). */
export interface HistoryStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ex: 'EX', seconds: number): Promise<unknown>;
}

interface Turn {
  q: string;
  a: string;
}

export function contentToText(content: LlmContent): string {
  if (typeof content === 'string') return content;
  return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

/**
 * Responde perguntas da gestão com a IA da org (MiniMax, pela chave de
 * Provedores IA) e ferramentas só de leitura. Nunca lança: falha vira texto.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly tools: AssistantTools,
    @Inject(MANAGER_BOT_HISTORY) private readonly history: () => Promise<HistoryStore>,
  ) {}

  async ask(org: AlertOrg, chatId: string, question: string, now: Date): Promise<string> {
    const turns = await this.loadHistory(org.id, chatId);
    const messages: LlmMessage[] = [
      { role: 'system', content: buildSystemPrompt(now, org.tz) },
      ...turns.flatMap((t): LlmMessage[] => [
        { role: 'user', content: t.q },
        { role: 'assistant', content: t.a },
      ]),
      { role: 'user', content: question },
    ];
    let answer: string;
    try {
      answer = await this.loop(org, messages, now);
    } catch (err) {
      this.logger.error(`gerente_tg_llm_falhou: ${err instanceof Error ? err.message : String(err)}`);
      return LLM_DOWN;
    }
    if (answer !== NO_ANSWER) await this.saveHistory(org.id, chatId, [...turns, { q: question, a: answer }]);
    return answer;
  }

  private async loop(org: AlertOrg, initial: LlmMessage[], now: Date): Promise<string> {
    let messages = initial;
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const response = await this.llm.complete({
        organizationId: org.id,
        modelId: SAKANA_CONVERSATION_MODEL,
        messages,
        // Na última rodada não oferece ferramentas: obriga a responder.
        tools: round < MAX_TOOL_ROUNDS ? ASSISTANT_TOOLS : undefined,
        temperature: TEMPERATURE,
        maxTokens: MAX_TOKENS,
      });
      const calls = response.message.toolCalls ?? [];
      if (calls.length === 0) {
        const text = stripThinkBlocks(contentToText(response.message.content));
        return text || NO_ANSWER;
      }
      const results = await Promise.all(
        calls.map(async (call): Promise<LlmMessage> => ({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: await this.tools.run(org, call.name, call.arguments, now),
        })),
      );
      // O raciocínio da rodada não volta para o modelo nem vai para o chat.
      const assistant: LlmMessage = {
        role: 'assistant',
        content: stripThinkBlocks(contentToText(response.message.content)),
        toolCalls: calls,
      };
      messages = [...messages, assistant, ...results];
    }
    return NO_ANSWER;
  }

  private key(organizationId: string, chatId: string): string {
    return `gerente-tg:hist:${organizationId}:${chatId}`;
  }

  private async loadHistory(organizationId: string, chatId: string): Promise<Turn[]> {
    try {
      const raw = await (await this.history()).get(this.key(organizationId, chatId));
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as Turn[]).slice(-HISTORY_TURNS) : [];
    } catch {
      return [];
    }
  }

  private async saveHistory(organizationId: string, chatId: string, turns: Turn[]): Promise<void> {
    try {
      const store = await this.history();
      await store.set(this.key(organizationId, chatId), JSON.stringify(turns.slice(-HISTORY_TURNS)), 'EX', HISTORY_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`gerente_tg_historico_nao_salvo: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** `/nova`: esquece o contexto do chat. */
  async reset(organizationId: string, chatId: string): Promise<void> {
    await this.saveHistory(organizationId, chatId, []);
  }
}
