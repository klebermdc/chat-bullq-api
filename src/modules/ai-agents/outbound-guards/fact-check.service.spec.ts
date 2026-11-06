import { FactCheckService } from './fact-check.service';

const CTX = {
  organizationId: 'org-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  channelId: 'ch-1',
  agentId: 'agent-aline',
  runId: 'run-1',
};

const EVIDENCIA = 'Magic Kingdom: abre às 9h. Epcot: abre às 10h.';

function make(llmReply: () => Promise<unknown>) {
  const llm = { complete: jest.fn(llmReply) } as any;
  const recorder = { record: jest.fn().mockResolvedValue(undefined) } as any;
  return { service: new FactCheckService(llm, recorder), llm, recorder };
}

const resposta = (texto: string) => async () => ({
  message: { role: 'assistant', content: texto },
  stopReason: 'stop',
  usage: {},
});

function input(text: string, priorToolCalls: Array<{ name: string; ok: boolean; output?: unknown }> = []) {
  return { ctx: CTX, text, promptEvidence: EVIDENCIA, priorToolCalls };
}

describe('FactCheckService', () => {
  it('grava "contradiz" com a frase e as notas', async () => {
    const { service, recorder } = make(
      resposta('{"claim_0":0.95,"supported_0":0.1,"contradicts_0":0.9}'),
    );

    await service.check(input('O Magic Kingdom abre às 7h.'));

    expect(recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        check: 'factual_claim',
        verdict: 'contradiz',
        sentence: 'O Magic Kingdom abre às 7h.',
        scores: expect.objectContaining({ claim_0: 0.95, contradicts_0: 0.9 }),
      }),
    );
  });

  it('grava "passa" sem frase quando tudo confere', async () => {
    const { service, recorder } = make(
      resposta('{"claim_0":0.9,"supported_0":0.95,"contradicts_0":0.02}'),
    );

    await service.check(input('O Magic Kingdom abre às 9h.'));

    expect(recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: 'passa', sentence: null }),
    );
  });

  it('manda as saídas das ferramentas do run como evidência, sem a do replyToConversation', async () => {
    const { service, llm } = make(resposta('{"claim_0":0.9,"supported_0":0.9,"contradicts_0":0}'));

    await service.check(
      input('O ingresso de 4 dias inclui os 4 parques.', [
        { name: 'lookupOffering', ok: true, output: { name: 'Ingresso 4 dias', parks: 4 } },
        { name: 'replyToConversation', ok: true, output: { messageId: 'msg-9' } },
      ]),
    );

    const user = llm.complete.mock.calls[0][0].messages[1].content as string;
    expect(user).toContain('Ingresso 4 dias');
    expect(user).toContain(EVIDENCIA);
    expect(user).not.toContain('msg-9');
  });

  it('sem frase conferível não chama o modelo e grava "nao_conferido"', async () => {
    const { service, llm, recorder } = make(resposta('{}'));

    await service.check(input('Bom dia! Como posso ajudar?'));

    expect(llm.complete).not.toHaveBeenCalled();
    expect(recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: 'nao_conferido', scores: { motivo: 'sem_frases' } }),
    );
  });

  it('falha do modelo vira "nao_conferido" e não lança', async () => {
    const { service, recorder } = make(async () => {
      throw new Error('LLM provider error: 429');
    });

    await expect(service.check(input('O Epcot abre às 10h.'))).resolves.toBeUndefined();
    expect(recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: 'nao_conferido', scores: { motivo: 'falha' } }),
    );
  });

  it('resposta ilegível vira "nao_conferido"', async () => {
    const { service, recorder } = make(resposta('não sei responder'));

    await service.check(input('O Epcot abre às 10h.'));

    expect(recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: 'nao_conferido', scores: { motivo: 'resposta_ilegivel' } }),
    );
  });

  it('estouro do prazo vira "nao_conferido"', async () => {
    const { service, recorder } = make(() => new Promise(() => undefined));

    await service.check(input('O Epcot abre às 10h.'), 5);

    expect(recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: 'nao_conferido', scores: { motivo: 'tempo_esgotado' } }),
    );
  });

  it('scheduleAfterSend não espera a conferência nem propaga erro', () => {
    const { service, recorder } = make(() => new Promise(() => undefined));
    recorder.record.mockRejectedValue(new Error('db fora'));

    expect(() => service.scheduleAfterSend(input('O Epcot abre às 10h.'))).not.toThrow();
  });
});
