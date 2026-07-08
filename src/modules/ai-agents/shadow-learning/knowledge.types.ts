/**
 * Tipos do aprendizado em modo SHADOW: o que o extrator devolve e o
 * payload do job de extração. Molde: memory/long-term/long-term.types.ts.
 */

/** Um item de conhecimento coletivo destilado de conversas guiamento. */
export interface KnowledgeItem {
  /** 'procedure' = passo a passo recorrente; 'qa' = par dúvida→resposta. */
  kind: 'procedure' | 'qa';
  /** Bucket livre — ex.: 'fast-pass', 'roteiro', 'remarcacao'. */
  category: string;
  /** Texto destilado (procedimento ou resposta padrão). 1-3 frases. */
  content: string;
  /** Só para kind='qa': a dúvida do cliente. */
  question?: string;
  /** 0-1, default 0.8 quando o modelo não retorna. */
  confidence?: number;
}

/** Entrada da extração — janela recente da conversa guiamento. */
export interface KnowledgeExtractionInput {
  organizationId: string;
  agentId: string;
  conversationId: string;
  /** Mensagens em ordem cronológica (oldest first). */
  messages: KnowledgeMessage[];
}

export interface KnowledgeMessage {
  /** 'customer' = cliente; 'operator' = atendente humano/saída. */
  role: 'customer' | 'operator';
  content: string;
  createdAt: string;
}

/** Saída do extrator. */
export interface KnowledgeExtractionResult {
  items: KnowledgeItem[];
  /** Explicação livre do modelo (debug/audit). */
  reasoning: string | null;
}

/** Payload do job BullMQ da fila 'knowledge-extractor'. */
export interface KnowledgeExtractorJobData {
  organizationId: string;
  agentId: string;
  conversationId: string;
}

/** Nome da fila BullMQ. */
export const KNOWLEDGE_EXTRACTOR_QUEUE = 'knowledge-extractor';
