import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { ConversationSummaryService } from './conversation-summary.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeService(resolved: any) {
  const providerKeys = { resolve: jest.fn().mockResolvedValue(resolved) } as any;
  return { svc: new ConversationSummaryService(providerKeys), providerKeys };
}

const TURNS = [
  { direction: 'INBOUND' as const, text: 'Quero remarcar meu ingresso' },
  { direction: 'OUTBOUND' as const, text: 'Claro, para qual data?' },
];

function llmReply(content: string) {
  return { data: { choices: [{ message: { content } }] } };
}

describe('ConversationSummaryService.summarize', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lança BadRequest quando não há chave AGENT_LLM', async () => {
    const { svc } = makeService(null);
    await expect(svc.summarize('org1', TURNS)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('usa base URL e modelo padrão da Groq e parseia o JSON', async () => {
    const { svc } = makeService({ provider: 'GROQ', apiKey: 'gsk_x' });
    mockedAxios.post.mockResolvedValue(
      llmReply('{"resumo":"Cliente quer remarcar ingresso.","sentimento":"neutro"}'),
    );

    const res = await svc.summarize('org1', TURNS);

    expect(res).toEqual({
      summary: 'Cliente quer remarcar ingresso.',
      sentiment: 'neutro',
      objection: null,
      replies: [],
    });
    const [url, body, cfg] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((body as any).model).toBe('llama-3.3-70b-versatile');
    expect((body as any).response_format).toEqual({ type: 'json_object' });
    expect((cfg as any).headers.Authorization).toBe('Bearer gsk_x');
  });

  it('respeita baseUrl e model informados pelo usuário', async () => {
    const { svc } = makeService({
      provider: 'OPENAI',
      apiKey: 'sk_x',
      baseUrl: 'https://custom.example.com/v1',
      model: 'gpt-4o',
    });
    mockedAxios.post.mockResolvedValue(llmReply('{"resumo":"ok","sentimento":"satisfeito"}'));

    await svc.summarize('org1', TURNS);

    const [url, body] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('https://custom.example.com/v1/chat/completions');
    expect((body as any).model).toBe('gpt-4o');
  });

  it('sentimento inválido vira "neutro"', async () => {
    const { svc } = makeService({ provider: 'GROQ', apiKey: 'gsk_x' });
    mockedAxios.post.mockResolvedValue(llmReply('{"resumo":"texto","sentimento":"furioso"}'));
    const res = await svc.summarize('org1', TURNS);
    expect(res.sentiment).toBe('neutro');
  });

  it('resumo vazio lança BadRequest', async () => {
    const { svc } = makeService({ provider: 'GROQ', apiKey: 'gsk_x' });
    mockedAxios.post.mockResolvedValue(llmReply('{"resumo":"  ","sentimento":"neutro"}'));
    await expect(svc.summarize('org1', TURNS)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('erro do provedor vira BadRequest amigável', async () => {
    const { svc } = makeService({ provider: 'GROQ', apiKey: 'gsk_x' });
    mockedAxios.post.mockRejectedValue({ response: { data: { error: { message: 'invalid api key' } } } });
    await expect(svc.summarize('org1', TURNS)).rejects.toThrow(/invalid api key/);
  });

  it('remove barra final da baseUrl (sem barra dupla)', async () => {
    const { svc } = makeService({
      provider: 'GROQ',
      apiKey: 'gsk_x',
      baseUrl: 'https://x.example.com/v1/',
    });
    mockedAxios.post.mockResolvedValue(llmReply('{"resumo":"ok","sentimento":"neutro"}'));

    await svc.summarize('org1', TURNS);

    const [url] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('https://x.example.com/v1/chat/completions');
  });

  it('choices ausente lança BadRequest', async () => {
    const { svc } = makeService({ provider: 'GROQ', apiKey: 'gsk_x' });
    mockedAxios.post.mockResolvedValue({ data: {} });
    await expect(svc.summarize('org1', TURNS)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('extrai o JSON de modelo de raciocínio que emite <think> antes (ex.: MiniMax)', async () => {
    const { svc } = makeService({ provider: 'OPENAI', apiKey: 'sk_x' });
    mockedAxios.post.mockResolvedValue(
      llmReply(
        '<think>O cliente quer remarcar. Sentimento parece neutro.</think>\n{"resumo":"Cliente quer remarcar o ingresso.","sentimento":"neutro"}',
      ),
    );
    const res = await svc.summarize('org1', TURNS);
    expect(res).toEqual({
      summary: 'Cliente quer remarcar o ingresso.',
      sentiment: 'neutro',
      objection: null,
      replies: [],
    });
  });

  it('extrai o JSON de dentro de cercas markdown ```json', async () => {
    const { svc } = makeService({ provider: 'OPENAI', apiKey: 'sk_x' });
    mockedAxios.post.mockResolvedValue(
      llmReply('```json\n{"resumo":"Resumo ok.","sentimento":"satisfeito"}\n```'),
    );
    const res = await svc.summarize('org1', TURNS);
    expect(res).toEqual({
      summary: 'Resumo ok.',
      sentiment: 'satisfeito',
      objection: null,
      replies: [],
    });
  });

  it('detecta objeção e gera 3 respostas de quebra de objeção', async () => {
    const { svc } = makeService({ provider: 'GROQ', apiKey: 'gsk_x' });
    mockedAxios.post.mockResolvedValue(
      llmReply(
        '{"resumo":"Cliente quer remarcar. Sugestão para o atendente: X","sentimento":"neutro","objecao":"achou caro","respostas":["a","b","c"]}',
      ),
    );

    const res = await svc.summarize('org1', TURNS);

    expect(res.objection).toBe('achou caro');
    expect(res.replies).toEqual(['a', 'b', 'c']);
    expect(res.replies).toHaveLength(3);
  });

  it('sem objeção retorna objection null e replies vazio', async () => {
    const { svc } = makeService({ provider: 'GROQ', apiKey: 'gsk_x' });
    mockedAxios.post.mockResolvedValue(
      llmReply(
        '{"resumo":"Tudo certo com o cliente.","sentimento":"neutro","objecao":null,"respostas":[]}',
      ),
    );

    const res = await svc.summarize('org1', TURNS);

    expect(res.objection).toBeNull();
    expect(res.replies).toHaveLength(0);
  });
});
