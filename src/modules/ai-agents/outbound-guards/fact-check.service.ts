import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { SAKANA_SIMPLE_MODEL } from '../llm/llm.constants';
import type { LlmContent } from '../llm/llm.types';
import type { ToolContext } from '../tools/tool.types';
import { decidirAfirmacoes, frasesParaConferir } from './factual-claim';
import { lerNotasDoJuiz, montarPedidoAoJuiz } from './fact-check-judge';
import { SendCheckRecorder } from './send-check.recorder';
import type { PriorToolCall } from './send-check.types';

/** Prazo do juiz. Passou disso, grava "não conferido" e segue. */
export const FACT_CHECK_TIMEOUT_MS = 20_000;
/** Teto do retorno de cada ferramenta na evidência. */
const MAX_TOOL_OUTPUT_CHARS = 6_000;
/** Teto da evidência inteira (system prompt + ferramentas). */
const MAX_EVIDENCE_CHARS = 80_000;
/** Folga para o <think> dos modelos de raciocínio (MiniMax) antes do JSON. */
const JUDGE_MAX_TOKENS = 2_000;
/** Saídas que não são fato do negócio (só o id da mensagem enviada). */
const TOOLS_FORA_DA_EVIDENCIA = new Set(['replyToConversation']);

export interface FactCheckInput {
  ctx: Pick<ToolContext, 'organizationId' | 'conversationId' | 'runId' | 'agentId'>;
  /** O texto que acabou de sair para o cliente. */
  text: string;
  /** O que foi no system prompt do run (segurança + instruções + catálogo). */
  promptEvidence: string;
  /** Ferramentas que rodaram antes desta resposta. */
  priorToolCalls: ReadonlyArray<PriorToolCall>;
}

type MotivoDeNaoConferir = 'sem_frases' | 'falha' | 'resposta_ilegivel' | 'tempo_esgotado';

class TempoEsgotado extends Error {}

/** Junta o system prompt com o retorno das ferramentas do run. */
export function montarEvidencia(
  promptEvidence: string,
  priorToolCalls: ReadonlyArray<PriorToolCall>,
): string {
  const ferramentas = priorToolCalls
    .filter((c) => c.ok && c.output !== undefined && !TOOLS_FORA_DA_EVIDENCIA.has(c.name))
    .map((c) => `[${c.name}] ${JSON.stringify(c.output).slice(0, MAX_TOOL_OUTPUT_CHARS)}`);
  const partes = [
    promptEvidence,
    ...(ferramentas.length > 0 ? ['═══ Retorno das consultas deste atendimento ═══', ...ferramentas] : []),
  ];
  return partes.join('\n\n').slice(0, MAX_EVIDENCE_CHARS);
}

function textoDe(content: LlmContent): string {
  if (typeof content === 'string') return content;
  return content.map((p) => (p.type === 'text' ? p.text : '')).join('');
}

/**
 * CONFERÊNCIA DE FATO (guard 3) — SÓ OBSERVA. Roda depois que a mensagem já
 * saiu, sem segurar o envio: uma chamada ao juiz por resposta, decisão em
 * código (`decidirAfirmacoes`) e uma linha em `ai_send_checks`. Nunca veta,
 * nunca lança; prazo estourado ou qualquer falha vira "nao_conferido".
 */
@Injectable()
export class FactCheckService {
  private readonly logger = new Logger(FactCheckService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly recorder: SendCheckRecorder,
  ) {}

  /** Dispara a conferência sem esperar (fire-and-forget). */
  scheduleAfterSend(input: FactCheckInput): void {
    this.check(input).catch((err) =>
      this.logger.warn(
        `[fact-check] falha inesperada run=${input.ctx.runId}: ${(err as Error)?.message ?? err}`,
      ),
    );
  }

  async check(input: FactCheckInput, timeoutMs = FACT_CHECK_TIMEOUT_MS): Promise<void> {
    const frases = frasesParaConferir(input.text);
    if (frases.length === 0) return this.naoConferido(input, 'sem_frases');

    const evidencia = montarEvidencia(input.promptEvidence, input.priorToolCalls);
    let bruto: string;
    try {
      bruto = await this.perguntarAoJuiz(input, frases, evidencia, timeoutMs);
    } catch (err) {
      const motivo = err instanceof TempoEsgotado ? 'tempo_esgotado' : 'falha';
      this.logger.warn(
        `[fact-check] ${motivo} run=${input.ctx.runId}: ${(err as Error)?.message ?? err}`,
      );
      return this.naoConferido(input, motivo);
    }

    const notas = lerNotasDoJuiz(bruto, frases.length);
    const resultado = notas ? decidirAfirmacoes(frases, notas, evidencia) : null;
    if (!notas || !resultado || resultado.ilegivel || !resultado.veredito) {
      return this.naoConferido(input, 'resposta_ilegivel');
    }

    if (resultado.veredito !== 'passa') {
      this.logger.warn(
        `[fact-check] ${resultado.veredito} (só observando) conv=${input.ctx.conversationId} run=${input.ctx.runId}`,
      );
    }
    await this.recorder.record({
      ...this.ids(input),
      check: 'factual_claim',
      verdict: resultado.veredito,
      sentence: resultado.frase,
      scores: notas,
    });
  }

  private async perguntarAoJuiz(
    input: FactCheckInput,
    frases: readonly string[],
    evidencia: string,
    timeoutMs: number,
  ): Promise<string> {
    const { system, user } = montarPedidoAoJuiz(frases, evidencia);
    const chamada = this.llm.complete({
      organizationId: input.ctx.organizationId,
      modelId: SAKANA_SIMPLE_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
      maxTokens: JUDGE_MAX_TOKENS,
    });
    let timer: NodeJS.Timeout | undefined;
    const prazo = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new TempoEsgotado(`juiz passou de ${timeoutMs}ms`)), timeoutMs);
    });
    try {
      const resposta = await Promise.race([chamada, prazo]);
      return textoDe(resposta.message.content);
    } finally {
      clearTimeout(timer);
    }
  }

  private naoConferido(input: FactCheckInput, motivo: MotivoDeNaoConferir): Promise<void> {
    return this.recorder.record({
      ...this.ids(input),
      check: 'factual_claim',
      verdict: 'nao_conferido',
      sentence: null,
      scores: { motivo },
    });
  }

  private ids(input: FactCheckInput) {
    const { organizationId, conversationId, runId, agentId } = input.ctx;
    return { organizationId, conversationId, runId, agentId };
  }
}
