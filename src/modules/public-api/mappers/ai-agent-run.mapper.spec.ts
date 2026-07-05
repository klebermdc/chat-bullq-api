import { mapAiAgentRun } from './ai-agent-run.mapper';

describe('mapAiAgentRun', () => {
  const raw = {
    id: 'r1', organizationId: 'o', conversationId: 'cv1', agentId: 'ag1', triggerMessageId: 'm1',
    status: 'COMPLETED', finalAction: 'REPLIED', errorMessage: null, modelId: 'claude-sonnet-5',
    inputTokens: 1200, outputTokens: 300, cacheReadTokens: 800, cacheWriteTokens: 0,
    costUsd: { toString: () => '0.004521', valueOf: () => 0.004521 },
    durationMs: 850, classifiedIntent: 'buy', classifierConfidence: { toString: () => '0.92' },
    startedAt: new Date('2026-03-01T10:00:00Z'), finishedAt: new Date('2026-03-01T10:00:01Z'),
    _count: { toolCalls: 3 },
  };

  it('expõe métricas públicas, converte costUsd para number e usa a contagem de toolCalls', () => {
    const out = mapAiAgentRun(raw as any);
    expect(out).toEqual({
      id: 'r1', conversationId: 'cv1', agentId: 'ag1', status: 'COMPLETED', finalAction: 'REPLIED',
      modelId: 'claude-sonnet-5', inputTokens: 1200, outputTokens: 300, costUsd: 0.004521, durationMs: 850,
      classifiedIntent: 'buy', startedAt: new Date('2026-03-01T10:00:00Z'), finishedAt: new Date('2026-03-01T10:00:01Z'),
      toolCallsCount: 3,
    });
    expect((out as any).errorMessage).toBeUndefined();
    expect((out as any).triggerMessageId).toBeUndefined();
    expect((out as any).organizationId).toBeUndefined();
  });

  it('toolCallsCount default 0 e costUsd tolerante a null', () => {
    const out = mapAiAgentRun({ id: 'r2', conversationId: 'c', agentId: 'a', status: 'RUNNING', modelId: 'm', inputTokens: 0, outputTokens: 0, costUsd: null, startedAt: new Date() } as any);
    expect(out.toolCallsCount).toBe(0);
    expect(out.costUsd).toBe(0);
  });
});
