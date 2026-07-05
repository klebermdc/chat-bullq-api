export interface PublicAiAgentRun {
  id: string;
  conversationId: string;
  agentId: string;
  status: string;
  finalAction: string | null;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number | null;
  classifiedIntent: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  toolCallsCount: number;
}

export function mapAiAgentRun(r: any): PublicAiAgentRun {
  return {
    id: r.id,
    conversationId: r.conversationId,
    agentId: r.agentId,
    status: r.status,
    finalAction: r.finalAction ?? null,
    modelId: r.modelId,
    inputTokens: r.inputTokens ?? 0,
    outputTokens: r.outputTokens ?? 0,
    costUsd: r.costUsd != null ? Number(r.costUsd) : 0,
    durationMs: r.durationMs ?? null,
    classifiedIntent: r.classifiedIntent ?? null,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt ?? null,
    toolCallsCount: r._count?.toolCalls ?? 0,
  };
}
