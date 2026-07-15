import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiProvider } from '@prisma/client';
import axios from 'axios';
import { ProviderKeyResolverService } from '../ai-provider-keys/provider-key-resolver.service';
import { SAKANA_DEFAULT_BASE_URL } from '../ai-agents/llm/llm.constants';

export type CallSentiment = 'positivo' | 'neutro' | 'negativo';

export interface CallInsight {
  summary: string;
  nextSteps: string[];
  sentiment: CallSentiment;
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

const SENTIMENTS: readonly CallSentiment[] = ['positivo', 'neutro', 'negativo'];

const SYSTEM_PROMPT = `IDIOMA: escreva TODA a saída exclusivamente em PORTUGUÊS DO BRASIL, correto e natural. NUNCA use caracteres de alfabetos não latinos.

Você resume LIGAÇÕES telefônicas para o time da Orlando Fast Pass. Você recebe a TRANSCRIÇÃO REAL de uma ligação (texto corrido, sem separar quem falou).

╔═ REGRA MAIS IMPORTANTE — FIDELIDADE ABSOLUTA ═╗
Baseie TUDO exclusivamente no que está ESCRITO na transcrição fornecida na mensagem do usuário. É TERMINANTEMENTE PROIBIDO inventar, supor, deduzir ou acrescentar QUALQUER informação que não apareça literalmente na transcrição. NÃO invente sintomas, doenças, planos de saúde, nomes de empresas, produtos, datas, valores, destinos, cidades, combinações ou qualquer fato. NÃO use exemplos ou modelos genéricos de call center. Se você não tem certeza de algo, NÃO escreva. Resuma APENAS o que foi REALMENTE dito naquele texto — nada além disso.
╚═══════════════════════════════════════════════╝

Se a transcrição for uma conversa informal, um TESTE de sistema, ou não tiver conteúdo de atendimento/comercial, diga isso honestamente (ex.: "Ligação de teste, sem conteúdo comercial." ou "Conversa informal, sem assunto de atendimento.") e deixe proximosPassos como [].

Produza:
(1) resumo — 2 a 4 frases FIÉIS ao que realmente foi dito na transcrição. Cite nomes/datas/valores SÓ se aparecerem no texto.
(2) proximosPassos — de 0 a 4 ações concretas que decorram DIRETAMENTE do que foi conversado. Se não houver ação real, use [].
(3) sentimento — "positivo", "neutro" ou "negativo", conforme o clima real da conversa.

Responda APENAS com um objeto JSON válido, sem markdown e sem texto fora do JSON:
{"resumo": "<texto fiel à transcrição>", "proximosPassos": ["..."], "sentimento": "positivo|neutro|negativo"}`;

/**
 * Gera o "Resumo da ligação" (transcrição -> insight) para o Card do Cliente e o
 * Painel Inteligente. Espelha o ConversationSummaryService: agnóstico de provedor,
 * resolve a chave AGENT_LLM da org e fala com a API OpenAI-compatible. Serviço puro
 * — não acessa o banco (quem persiste é o CallInsightProcessor).
 */
@Injectable()
export class CallInsightService {
  private readonly logger = new Logger(CallInsightService.name);

  constructor(private readonly providerKeys: ProviderKeyResolverService) {}

  async summarize(organizationId: string, transcript: string): Promise<CallInsight> {
    const resolved = await this.providerKeys.resolve(organizationId, 'AGENT_LLM');
    if (!resolved) {
      throw new BadRequestException(
        'Nenhuma chave de IA configurada. Cadastre uma chave com a função LLM em Configurações › Provedores IA.',
      );
    }

    const baseUrl = (resolved.baseUrl ?? CHAT_BASE_URL[resolved.provider]).replace(/\/$/, '');
    const model = resolved.model ?? DEFAULT_MODEL[resolved.provider];
    this.logger.log(`Resumo de ligação com ${resolved.provider}/${model} (${transcript.length} chars de transcrição)`);

    const body = {
      model,
      temperature: 0, // fidelidade máxima à transcrição — zero "criatividade"/alucinação
      max_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Resuma SOMENTE a ligação abaixo, sem inventar nada que não esteja escrita nela. Se for teste/conversa informal, diga isso.\n\n<<<TRANSCRICAO>>>\n${transcript}\n<<<FIM>>>`,
        },
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
      this.logger.error(`Resumo de ligação falhou (${resolved.provider}/${model}): ${detail}`);
      throw new BadRequestException(`Não foi possível gerar o resumo da ligação: ${detail}`);
    }

    const raw = response.data?.choices?.[0]?.message?.content ?? '';
    return this.parse(String(raw));
  }

  private parse(raw: string): CallInsight {
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

    const rawSteps = Array.isArray(obj.proximosPassos)
      ? obj.proximosPassos
      : Array.isArray(obj.nextSteps)
        ? obj.nextSteps
        : [];
    const nextSteps = rawSteps
      .filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s: string) => s.trim())
      .slice(0, 4);

    const rawSent = String(obj.sentimento ?? obj.sentiment ?? '').toLowerCase().trim();
    const sentiment: CallSentiment = (SENTIMENTS as readonly string[]).includes(rawSent)
      ? (rawSent as CallSentiment)
      : 'neutro';

    return { summary, nextSteps, sentiment };
  }

  /** Recorta o JSON de dentro de respostas com <think>/cercas markdown. */
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
