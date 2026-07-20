import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../ai-agents/llm/llm.service';
import { SAKANA_SIMPLE_MODEL } from '../ai-agents/llm/llm.constants';
import { RELEVANCE_SYSTEM_PROMPT } from './order-ficha.prompts';

/**
 * Gate barato (Fugu, temp 0) que decide se UMA mensagem do cliente descreve
 * ou altera um pedido concreto — evita rodar o extrator (mais caro) em
 * saudações, dúvidas genéricas ou "ok"/"obrigado".
 *
 * Fail-closed: qualquer erro do LLM (chave ausente, timeout, JSON malformado)
 * retorna `false` em vez de derrubar o fluxo do chat.
 */
@Injectable()
export class OrderRelevanceService {
  private readonly logger = new Logger(OrderRelevanceService.name);

  constructor(private readonly llm: LlmService) {}

  async isOrderMessage(text: string, organizationId: string): Promise<boolean> {
    try {
      const resp = await this.llm.complete({
        organizationId,
        modelId: SAKANA_SIMPLE_MODEL,
        temperature: 0,
        maxTokens: 50,
        messages: [
          {
            role: 'system',
            content: [{ type: 'text', text: RELEVANCE_SYSTEM_PROMPT, cache: true }],
          },
          { role: 'user', content: text },
        ],
      });

      const raw = this.textOnly(resp.message.content);
      const parsed = this.tolerantParse(raw);
      return parsed?.describesOrder === true;
    } catch (err) {
      this.logger.warn(
        `relevance gate falhou, fail-closed: ${(err as Error)?.message ?? err}`,
      );
      return false;
    }
  }

  private textOnly(content: string | Array<{ type: string; text?: string }>): string {
    if (typeof content === 'string') return content;
    return content
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('');
  }

  /**
   * Parse tolerante: JSON direto, senão extrai o primeiro `{...}` balanceado
   * (modelos às vezes embrulham em markdown ou adicionam texto extra).
   */
  private tolerantParse(raw: string): Record<string, unknown> | null {
    if (!raw) return null;
    const trimmed = raw.trim();

    try {
      return JSON.parse(trimmed);
    } catch {
      // segue pro fallback
    }

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }

    return null;
  }
}
