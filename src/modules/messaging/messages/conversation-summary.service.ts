import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { AiProvider } from '@prisma/client';
import axios from 'axios';
import { ProviderKeyResolverService } from '../../ai-provider-keys/provider-key-resolver.service';
import { SAKANA_DEFAULT_BASE_URL } from '../../ai-agents/llm/llm.constants';

export type Sentiment = 'satisfeito' | 'neutro' | 'irritado';

export interface SummaryTurn {
  direction: 'INBOUND' | 'OUTBOUND';
  text: string;
}

export interface SummaryResult {
  summary: string;
  sentiment: Sentiment;
}

const CHAT_BASE_URL: Record<AiProvider, string> = {
  GROQ: 'https://api.groq.com/openai/v1',
  OPENAI: 'https://api.openai.com/v1',
  SAKANA: SAKANA_DEFAULT_BASE_URL,
};

const DEFAULT_MODEL: Record<AiProvider, string> = {
  GROQ: 'llama-3.3-70b-versatile',
  OPENAI: 'gpt-4o-mini',
  SAKANA: 'fugu',
};

const SENTIMENTS: readonly Sentiment[] = ['satisfeito', 'neutro', 'irritado'];

const SYSTEM_PROMPT = `Você resume conversas de atendimento ao cliente em português do Brasil, para o atendente se situar rapidamente ao assumir o chat.
Responda APENAS com um objeto JSON válido, sem markdown e sem texto fora do JSON, no formato:
{"resumo": "<texto>", "sentimento": "<satisfeito|neutro|irritado>"}

No campo "resumo", escreva de 4 a 6 frases claras cobrindo: o que o cliente quer, o contexto/histórico relevante, o que já foi resolvido ou combinado, e onde a conversa parou (pendências ou próximo passo aguardado). Seja específico com nomes, datas e valores citados.
Termine SEMPRE o resumo com uma última frase iniciada por "Sugestão para o atendente: " recomendando a próxima ação concreta a tomar (ex.: o que responder, o que confirmar, ou como avançar a conversa).
O campo "sentimento" reflete o humor do CLIENTE. Use exatamente uma das três palavras.`;

/**
 * Gera o "Resumo IA" do Painel Inteligente. Diferente do LlmService (travado
 * na Sakana Fugu), este serviço é agnóstico de provedor: resolve a chave
 * AGENT_LLM da org e fala com a API OpenAI-compatible do provedor cadastrado
 * (Groq/OpenAI/Sakana), escolhendo base URL e modelo por provedor. Serviço
 * puro — não acessa o banco; o cache vive em ConversationsService.
 */
@Injectable()
export class ConversationSummaryService {
  private readonly logger = new Logger(ConversationSummaryService.name);

  constructor(private readonly providerKeys: ProviderKeyResolverService) {}

  async summarize(organizationId: string, turns: SummaryTurn[]): Promise<SummaryResult> {
    const resolved = await this.providerKeys.resolve(organizationId, 'AGENT_LLM');
    if (!resolved) {
      throw new BadRequestException(
        'Nenhuma chave de IA configurada. Cadastre uma chave com a função LLM em Configurações › Provedores IA.',
      );
    }

    const baseUrl = (resolved.baseUrl ?? CHAT_BASE_URL[resolved.provider]).replace(/\/$/, '');
    const model = resolved.model ?? DEFAULT_MODEL[resolved.provider];

    const transcript = turns
      .map((t) => `${t.direction === 'INBOUND' ? 'Cliente' : 'Atendente'}: ${t.text}`)
      .join('\n');

    const body = {
      model,
      temperature: 0.3,
      // Alto o bastante para modelos de raciocínio (ex.: MiniMax M-series)
      // que gastam tokens num bloco <think> antes de emitir o JSON.
      max_tokens: 2048,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Conversa:\n\n${transcript}` },
      ],
    };

    let response;
    try {
      response = await axios.post(`${baseUrl}/chat/completions`, body, {
        headers: {
          Authorization: `Bearer ${resolved.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60_000,
      });
    } catch (err: any) {
      const detail = err?.response?.data?.error?.message || err?.message || 'erro desconhecido';
      this.logger.error(`Resumo IA falhou (${resolved.provider}/${model}): ${detail}`);
      throw new BadRequestException(`Não foi possível gerar o resumo: ${detail}`);
    }

    const raw = response.data?.choices?.[0]?.message?.content ?? '';
    return this.parse(String(raw));
  }

  private parse(raw: string): SummaryResult {
    let obj: any = {};
    try {
      obj = JSON.parse(this.extractJson(raw));
    } catch {
      this.logger.warn(`Resposta do LLM não é JSON válido: ${raw.slice(0, 300)}`);
      obj = {};
    }

    const summary =
      (typeof obj.resumo === 'string' && obj.resumo.trim()) ||
      (typeof obj.summary === 'string' && obj.summary.trim()) ||
      '';
    if (!summary) {
      throw new BadRequestException('O provedor de IA retornou um resumo vazio.');
    }

    const rawSent = String(obj.sentimento ?? obj.sentiment ?? '').toLowerCase().trim();
    const sentiment: Sentiment = (SENTIMENTS as readonly string[]).includes(rawSent)
      ? (rawSent as Sentiment)
      : 'neutro';

    return { summary, sentiment };
  }

  /**
   * Extrai o objeto JSON de dentro da resposta bruta. Modelos de raciocínio
   * (ex.: MiniMax M-series) emitem um bloco `<think>...</think>` antes do JSON,
   * e alguns embrulham em cercas markdown (```json). Removemos esses ruídos e
   * recortamos do primeiro `{` até o último `}`.
   */
  private extractJson(raw: string): string {
    const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
    const withoutFences = withoutThink.replace(/```(?:json)?/gi, '');
    const first = withoutFences.indexOf('{');
    const last = withoutFences.lastIndexOf('}');
    if (first !== -1 && last > first) {
      return withoutFences.slice(first, last + 1);
    }
    return withoutFences.trim();
  }
}
