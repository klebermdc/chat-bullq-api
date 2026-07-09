import { Injectable, Logger } from '@nestjs/common';

import { LlmService } from '../llm/llm.service';
import { SAKANA_SIMPLE_MODEL } from '../llm/llm.constants';
import {
  KnowledgeExtractionInput,
  KnowledgeExtractionResult,
  KnowledgeItem,
} from './knowledge.types';

/**
 * Extrator de conhecimento coletivo (modo SHADOW) — usa o Sakana Fugu barato
 * para destilar, de uma janela recente de conversa de atendimento (guiamento
 * em parques), COMO O ATENDENTE HUMANO resolve as dúvidas: procedimentos
 * recorrentes e pares dúvida→resposta.
 *
 * Molde: memory/long-term/memory-extractor.service.ts. Custo escala com o
 * volume de conversas, então fixamos o caminho mais barato (Fugu simples).
 */
@Injectable()
export class KnowledgeExtractorService {
  private readonly logger = new Logger(KnowledgeExtractorService.name);
  private readonly modelId = SAKANA_SIMPLE_MODEL;

  constructor(private readonly llm: LlmService) {}

  async extract(
    input: KnowledgeExtractionInput,
  ): Promise<KnowledgeExtractionResult> {
    if (input.messages.length === 0) {
      return { items: [], reasoning: null };
    }

    const transcript = input.messages
      .map(
        (m) =>
          `[${m.role === 'customer' ? 'CLIENTE' : 'ATENDENTE'}] ${m.content}`,
      )
      .join('\n');

    const systemPrompt = [
      'Você analisa conversas de atendimento de turismo (acompanhamento em parques).',
      'Extraia COMO O ATENDENTE HUMANO resolve as dúvidas — procedimentos recorrentes e pares dúvida→resposta.',
      'Foque nas mensagens do ATENDENTE (é o "como o time faz"). Ignore saudações e small talk.',
      'Responda SOMENTE JSON válido no formato:',
      '{"items":[{"kind":"procedure|qa","category":"string-curta","question":"só se kind=qa","content":"1-3 frases"}],"reasoning":"string"}',
      'Se não houver nada de aprendizado, retorne {"items":[],"reasoning":null}.',
    ].join('\n');

    const userPrompt = `Conversa:\n${transcript}`;

    let response;
    try {
      response = await this.llm.complete({
        organizationId: input.organizationId,
        modelId: this.modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxTokens: 1000,
        temperature: 0.2,
      });
    } catch (err) {
      this.logger.warn(
        `knowledge_extract_llm_failed agent=${input.agentId} conversation=${input.conversationId}: ${(err as Error).message}`,
      );
      return { items: [], reasoning: null };
    }

    const content =
      typeof response.message.content === 'string'
        ? response.message.content
        : response.message.content
            .filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join('');

    const parsed = this.tolerantParse(content);
    if (!parsed || !Array.isArray(parsed.items)) {
      return { items: [], reasoning: null };
    }

    const items: KnowledgeItem[] = parsed.items
      .filter(
        (i: any) =>
          i &&
          typeof i.content === 'string' &&
          (i.kind === 'procedure' || i.kind === 'qa'),
      )
      .map((i: any) => ({
        kind: i.kind,
        category:
          typeof i.category === 'string' && i.category.trim()
            ? i.category.trim()
            : 'geral',
        content: i.content.trim(),
        question:
          i.kind === 'qa' && typeof i.question === 'string'
            ? i.question.trim()
            : undefined,
        confidence: typeof i.confidence === 'number' ? i.confidence : 0.8,
      }));

    return {
      items,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : null,
    };
  }

  /**
   * Tenta `JSON.parse` direto, depois remove cercas markdown, depois extrai o
   * primeiro bloco `{...}`. Fugu às vezes embrulha o JSON ou adiciona texto.
   */
  private tolerantParse(raw: string): any | null {
    if (!raw) return null;
    const stripped = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    try {
      return JSON.parse(stripped);
    } catch {
      const match = stripped.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }
}
