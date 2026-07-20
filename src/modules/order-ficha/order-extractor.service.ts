import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../ai-agents/llm/llm.service';
import { SAKANA_SIMPLE_MODEL } from '../ai-agents/llm/llm.constants';
import { EXTRACT_SYSTEM_PROMPT } from './order-ficha.prompts';
import { ExtractedOrder, OrderItem } from './order-ficha.types';

const EMPTY: ExtractedOrder = {
  items: [],
  travelDatesText: null,
  travelStart: null,
  travelEnd: null,
};

/**
 * Extrator grounded (Fugu, temp 0) do pedido a partir das últimas mensagens
 * do cliente. NÃO deduz — só registra o que está literal. Qualquer falha de
 * LLM ou parsing devolve o resultado vazio em vez de quebrar o fluxo.
 */
@Injectable()
export class OrderExtractorService {
  private readonly logger = new Logger(OrderExtractorService.name);

  constructor(private readonly llm: LlmService) {}

  async extract(
    recentCustomerMessages: string[],
    organizationId: string,
  ): Promise<ExtractedOrder> {
    const block = `<<<MSGS>>>\n${recentCustomerMessages.join('\n')}\n<<<END>>>`;

    try {
      const resp = await this.llm.complete({
        organizationId,
        modelId: SAKANA_SIMPLE_MODEL,
        temperature: 0,
        maxTokens: 800,
        messages: [
          {
            role: 'system',
            content: [{ type: 'text', text: EXTRACT_SYSTEM_PROMPT, cache: true }],
          },
          { role: 'user', content: block },
        ],
      });

      return this.parse(this.textOnly(resp.message.content));
    } catch (err) {
      this.logger.warn(`extração falhou: ${(err as Error)?.message ?? err}`);
      return EMPTY;
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
   * Parse tolerante: tira blocos `<think>...</think>` (modelos de raciocínio
   * às vezes vazam), extrai o primeiro `{...}` balanceado, e filtra itens
   * inválidos em vez de deixar o resultado quebrado propagar.
   */
  private parse(raw: string): ExtractedOrder {
    try {
      const noThink = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
      const start = noThink.indexOf('{');
      const end = noThink.lastIndexOf('}');
      if (start < 0 || end <= start) return EMPTY;

      const j = JSON.parse(noThink.slice(start, end + 1));

      return {
        items: this.normalizeItems(j.items),
        travelDatesText:
          typeof j.travelDatesText === 'string' ? j.travelDatesText : null,
        travelStart: typeof j.travelStart === 'string' ? j.travelStart : null,
        travelEnd: typeof j.travelEnd === 'string' ? j.travelEnd : null,
      };
    } catch {
      return EMPTY;
    }
  }

  private normalizeItems(raw: unknown): OrderItem[] {
    if (!Array.isArray(raw)) return [];
    const out: OrderItem[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      if (typeof r.produto !== 'string' || typeof r.quantidade !== 'number') continue;
      out.push({
        produto: r.produto,
        quantidade: r.quantidade,
        tipo: r.tipo === 'adulto' || r.tipo === 'crianca' ? r.tipo : null,
      });
    }
    return out;
  }
}
