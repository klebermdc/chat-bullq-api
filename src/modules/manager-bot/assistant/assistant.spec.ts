import type { LlmCompletionRequest, LlmCompletionResponse, LlmMessage } from '../../ai-agents/llm/llm.types';
import { matchesAgent, parsePeriod, ToolInputError } from './assistant.period';
import { LLM_DOWN, NO_ANSWER } from './assistant.prompt';
import { AssistantService, HISTORY_TURNS, MAX_TOOL_ROUNDS, type HistoryStore } from './assistant.service';
import { AssistantTools } from './assistant.tools';

const TZ = 'America/Sao_Paulo';
const ORG = { id: 'org', settings: {}, tz: TZ, orgHours: null };
const NOW = new Date('2026-11-12T18:00:00Z');

function reply(message: Partial<LlmMessage>): LlmCompletionResponse {
  return {
    message: { role: 'assistant', content: '', ...message },
    stopReason: message.toolCalls?.length ? 'tool_calls' : 'stop',
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
    rawModelId: 'MiniMax-M2',
  };
}

function memoryStore() {
  const data = new Map<string, string>();
  const store: HistoryStore = {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => data.set(k, v),
  };
  return { data, store };
}

function setup(responses: LlmCompletionResponse[]) {
  const requests: LlmCompletionRequest[] = [];
  const llm = {
    complete: jest.fn(async (req: LlmCompletionRequest) => {
      requests.push({ ...req, messages: [...req.messages] });
      const next = responses.shift();
      if (!next) throw new Error('sem resposta');
      return next;
    }),
  };
  const tools = { run: jest.fn(async () => '{"percentual":92}') };
  const { data, store } = memoryStore();
  const service = new AssistantService(llm as never, tools as unknown as AssistantTools, async () => store);
  return { service, llm, tools, requests, data };
}

describe('AssistantService.ask', () => {
  it('chama a ferramenta, devolve o resultado ao modelo e responde sem o <think>', async () => {
    const s = setup([
      reply({ content: '<think>preciso do sla</think>', toolCalls: [{ id: 'c1', name: 'sla_periodo', arguments: { inicio: '2026-11-09', fim: '2026-11-12' } }] }),
      reply({ content: '<think>ok</think>SLA da semana: 92%.' }),
    ]);
    const answer = await s.service.ask(ORG, '1', 'sla da semana?', NOW);
    expect(answer).toBe('SLA da semana: 92%.');
    expect(s.tools.run).toHaveBeenCalledWith(ORG, 'sla_periodo', { inicio: '2026-11-09', fim: '2026-11-12' }, NOW);
    const second = s.requests[1].messages;
    expect(second[second.length - 1]).toMatchObject({ role: 'tool', toolCallId: 'c1', content: '{"percentual":92}' });
    expect(second[second.length - 2]).toMatchObject({ role: 'assistant', content: '' });
  });

  it('o prompt traz a data de hoje no fuso de SP', async () => {
    const s = setup([reply({ content: 'oi' })]);
    await s.service.ask(ORG, '1', 'oi', NOW);
    expect(String(s.requests[0].messages[0].content)).toContain('2026-11-12');
  });

  it('desiste depois do limite de rodadas e não oferece ferramenta na última', async () => {
    const loopCall = () => reply({ toolCalls: [{ id: 'x', name: 'fila_agora', arguments: {} }] });
    const s = setup(Array.from({ length: MAX_TOOL_ROUNDS + 1 }, loopCall));
    expect(await s.service.ask(ORG, '1', 'fila?', NOW)).toBe(NO_ANSWER);
    expect(s.requests[MAX_TOOL_ROUNDS].tools).toBeUndefined();
  });

  it('resposta só com raciocínio vira aviso, não texto vazio', async () => {
    const s = setup([reply({ content: '<think>hmm' })]);
    expect(await s.service.ask(ORG, '1', 'oi', NOW)).toBe(NO_ANSWER);
  });

  it('IA fora do ar responde com aviso', async () => {
    const s = setup([]);
    expect(await s.service.ask(ORG, '1', 'oi', NOW)).toBe(LLM_DOWN);
  });

  it('lembra as trocas anteriores do mesmo chat, no máximo N', async () => {
    const s = setup(Array.from({ length: HISTORY_TURNS + 2 }, (_, i) => reply({ content: `r${i}` })));
    for (let i = 0; i < HISTORY_TURNS + 1; i += 1) await s.service.ask(ORG, '1', `p${i}`, NOW);
    await s.service.ask(ORG, '1', 'e ontem?', NOW);
    const last = s.requests[s.requests.length - 1].messages;
    expect(last).toHaveLength(1 + HISTORY_TURNS * 2 + 1);
    expect(last[1]).toMatchObject({ role: 'user', content: 'p1' });
    expect(last[last.length - 1]).toMatchObject({ role: 'user', content: 'e ontem?' });
  });

  it('/nova esquece o contexto', async () => {
    const s = setup([reply({ content: 'a' }), reply({ content: 'b' })]);
    await s.service.ask(ORG, '1', 'p', NOW);
    await s.service.reset('org', '1');
    await s.service.ask(ORG, '1', 'q', NOW);
    expect(s.requests[1].messages).toHaveLength(2);
  });
});

describe('parsePeriod', () => {
  it('converte dias locais em intervalo UTC fechado no início e aberto no fim', () => {
    const r = parsePeriod('2026-11-09', '2026-11-15', TZ);
    expect(r.from.toISOString()).toBe('2026-11-09T03:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-11-16T03:00:00.000Z');
  });
  it('recusa data inválida, invertida ou período longo demais', () => {
    expect(() => parsePeriod('ontem', '2026-11-15', TZ)).toThrow(ToolInputError);
    expect(() => parsePeriod('2026-11-15', '2026-11-01', TZ)).toThrow('inicio depois do fim');
    expect(() => parsePeriod('2026-01-01', '2026-11-15', TZ)).toThrow('maior que 90 dias');
  });
});

describe('matchesAgent', () => {
  it('ignora acento e caixa e aceita pedaço do nome', () => {
    expect(matchesAgent('Bárbara Lima', 'barbara')).toBe(true);
    expect(matchesAgent('Pedro', 'barbara')).toBe(false);
    expect(matchesAgent('Pedro', undefined)).toBe(true);
  });
});

describe('AssistantTools.run', () => {
  const tools = new AssistantTools({} as never, {} as never, { queue: async () => ({ unassigned: 3, oldestSince: null }) } as never, {} as never);

  it('ferramenta desconhecida vira erro em JSON', async () => {
    expect(JSON.parse(await tools.run(ORG, 'apagar_tudo', {}, NOW))).toEqual({ erro: 'ferramenta desconhecida: apagar_tudo' });
  });
  it('entrada inválida vira erro legível', async () => {
    expect(JSON.parse(await tools.run(ORG, 'volume_periodo', { inicio: 'x', fim: 'y' }, NOW))).toEqual({
      erro: 'inicio e fim precisam ser datas YYYY-MM-DD',
    });
  });
  it('executa a ferramenta e devolve JSON', async () => {
    expect(JSON.parse(await tools.run(ORG, 'fila_agora', {}, NOW))).toEqual({ unassigned: 3, oldestSince: null });
  });
});
