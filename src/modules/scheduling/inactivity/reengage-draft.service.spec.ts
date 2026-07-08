import { ReengageDraftService } from './reengage-draft.service';

function makeDeps(llmText: string | null, throws = false) {
  const prisma = {
    message: {
      findMany: jest.fn(async () => [
        { direction: 'OUTBOUND', content: { text: 'Oi, tudo bem?' }, type: 'TEXT' },
        { direction: 'INBOUND', content: { text: 'Vou pensar' }, type: 'TEXT' },
      ]),
    },
  };
  // Mirror the REAL LlmService.complete() return shape: LlmCompletionResponse
  // ({ message: { role, content }, stopReason, usage, rawModelId }). The draft
  // text lives in res.message.content.
  const llm = {
    complete: jest.fn(async () => {
      if (throws) throw new Error('no key');
      return {
        message: { role: 'assistant', content: llmText },
        stopReason: 'stop',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
        },
        rawModelId: 'fugu',
      };
    }),
  };
  return {
    service: new ReengageDraftService(prisma as any, llm as any),
    prisma,
    llm,
  };
}

describe('ReengageDraftService', () => {
  it('retorna o texto do LLM', async () => {
    const { service, llm } = makeDeps('Oi! Posso te ajudar a finalizar?');
    expect(await service.draft('org1', 'c1')).toBe(
      'Oi! Posso te ajudar a finalizar?',
    );
    // Passa organizationId + um modelId válido (obrigatório no request real).
    expect(llm.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org1',
        modelId: expect.stringContaining('sakana/'),
      }),
    );
  });

  it('faz trim e retorna null quando o texto é vazio', async () => {
    const { service } = makeDeps('   ');
    expect(await service.draft('org1', 'c1')).toBeNull();
  });

  it('retorna null quando o LLM falha (sem chave / erro)', async () => {
    const { service } = makeDeps(null, true);
    expect(await service.draft('org1', 'c1')).toBeNull();
  });
});
