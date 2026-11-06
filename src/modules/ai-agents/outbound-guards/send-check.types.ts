/** Qual trava de saída gerou a linha em `ai_send_checks`. */
export type SendCheckKind = 'commercial' | 'human_promise' | 'factual_claim';

/** `blocked` = guards 1 e 2; os demais = conferência de fato (guard 3, só observa). */
export type SendCheckVerdict =
  | 'blocked'
  | 'passa'
  | 'contradiz'
  | 'nao_esta_na_base'
  | 'nao_conferido';

/** Uma ferramenta que já rodou neste run, em ordem. */
export interface PriorToolCall {
  name: string;
  /** A ferramenta funcionou (sem exceção e sem `ok: false`). */
  ok: boolean;
  /** Retorno da ferramenta (vira evidência da conferência de fato). */
  output?: unknown;
}

/** O que o runner passa às ferramentas para as travas de saída do replyToConversation. */
export interface OutboundGuardContext {
  /** Ferramentas que já rodaram neste run ANTES desta chamada (inclusive no mesmo lote). */
  priorToolCalls: ReadonlyArray<PriorToolCall>;
  /**
   * Texto que foi no system prompt deste run (segurança + instruções/persona +
   * catálogo). Ausente = mensagem montada pelo sistema, sem conferência de fato.
   */
  promptEvidence?: string;
}

/** Ids da linha gravada. */
export interface SendCheckIds {
  organizationId: string;
  conversationId: string;
  runId: string;
  agentId: string;
}
