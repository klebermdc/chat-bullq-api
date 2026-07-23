import { OrderExtractorService } from './order-extractor.service';

describe('OrderExtractorService', () => {
  const llm = { complete: jest.fn() } as any;
  const svc = new OrderExtractorService(llm);

  beforeEach(() => {
    llm.complete.mockReset();
  });

  it('extrai itens e datas de texto solto', async () => {
    llm.complete.mockResolvedValue({
      message: {
        role: 'assistant',
        content:
          '{"items":[{"produto":"Magic Kingdom","quantidade":4,"tipo":null}],"travelDatesText":"julho/2026","travelStart":null,"travelEnd":null}',
      },
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
      stopReason: 'stop',
      rawModelId: 'fugu',
    });
    const out = await svc.extract(['quero 4 ingressos Magic Kingdom em julho'], 'o1');
    expect(out.items).toEqual([{ produto: 'Magic Kingdom', quantidade: 4, tipo: null }]);
    expect(out.travelDatesText).toBe('julho/2026');
    expect(out.travelStart).toBeNull();
  });

  it('não inventa: sem dados => vazio/null', async () => {
    llm.complete.mockResolvedValue({
      message: {
        role: 'assistant',
        content: '{"items":[],"travelDatesText":null,"travelStart":null,"travelEnd":null}',
      },
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
      stopReason: 'stop',
      rawModelId: 'fugu',
    });
    const out = await svc.extract(['oi'], 'o1');
    expect(out.items).toEqual([]);
  });

  it('LLM falha => retorna vazio (não quebra)', async () => {
    llm.complete.mockRejectedValue(new Error('x'));
    const out = await svc.extract(['quero ingressos'], 'o1');
    expect(out.items).toEqual([]);
  });
});
