import { OrderRelevanceService } from './order-relevance.service';

describe('OrderRelevanceService', () => {
  const llm = { complete: jest.fn() } as any;
  const svc = new OrderRelevanceService(llm);

  beforeEach(() => {
    llm.complete.mockReset();
  });

  it('true quando o LLM retorna describesOrder', async () => {
    llm.complete.mockResolvedValue({
      message: { role: 'assistant', content: '{"describesOrder": true}' },
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
      stopReason: 'stop',
      rawModelId: 'fugu',
    });
    expect(await svc.isOrderMessage('quero 4 ingressos Magic Kingdom', 'o1')).toBe(true);
  });

  it('false em saudação', async () => {
    llm.complete.mockResolvedValue({
      message: { role: 'assistant', content: '{"describesOrder": false}' },
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
      stopReason: 'stop',
      rawModelId: 'fugu',
    });
    expect(await svc.isOrderMessage('oi bom dia', 'o1')).toBe(false);
  });

  it('false quando o LLM falha (fail-closed)', async () => {
    llm.complete.mockRejectedValue(new Error('boom'));
    expect(await svc.isOrderMessage('quero ingressos', 'o1')).toBe(false);
  });
});
