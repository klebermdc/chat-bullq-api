import axios from 'axios';
import { CallInsightService } from './call-insight.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeSvc(resolved: any = { provider: 'GROQ', apiKey: 'k' }) {
  const providerKeys = { resolve: jest.fn(async () => resolved) } as any;
  return new CallInsightService(providerKeys);
}

function llmReply(content: string) {
  return { data: { choices: [{ message: { content } }] } } as any;
}

describe('CallInsightService.summarize', () => {
  afterEach(() => jest.clearAllMocks());

  it('parseia summary + nextSteps + sentiment do JSON do LLM', async () => {
    mockedAxios.post.mockResolvedValue(
      llmReply('{"resumo":"Cliente quer pacote Disney em julho.","proximosPassos":["Enviar cotação","Confirmar transfer"],"sentimento":"positivo"}'),
    );
    const svc = makeSvc();
    const out = await svc.summarize('org1', 'transcrição...');
    expect(out.summary).toContain('Disney');
    expect(out.nextSteps).toEqual(['Enviar cotação', 'Confirmar transfer']);
    expect(out.sentiment).toBe('positivo');
  });

  it('tolera JSON embrulhado em <think> e cercas markdown', async () => {
    mockedAxios.post.mockResolvedValue(
      llmReply('<think>hmm</think>```json\n{"resumo":"ok","proximosPassos":[],"sentimento":"neutro"}\n```'),
    );
    const svc = makeSvc();
    const out = await svc.summarize('org1', 't');
    expect(out.summary).toBe('ok');
    expect(out.sentiment).toBe('neutro');
  });

  it('sentimento inválido cai em neutro', async () => {
    mockedAxios.post.mockResolvedValue(llmReply('{"resumo":"x","proximosPassos":[],"sentimento":"eufórico"}'));
    const svc = makeSvc();
    expect((await svc.summarize('org1', 't')).sentiment).toBe('neutro');
  });

  it('lança se não há chave AGENT_LLM configurada', async () => {
    const svc = makeSvc(null);
    await expect(svc.summarize('org1', 't')).rejects.toThrow();
  });

  it('lança se o resumo vier vazio', async () => {
    mockedAxios.post.mockResolvedValue(llmReply('{"resumo":"","proximosPassos":[],"sentimento":"neutro"}'));
    const svc = makeSvc();
    await expect(svc.summarize('org1', 't')).rejects.toThrow();
  });
});
