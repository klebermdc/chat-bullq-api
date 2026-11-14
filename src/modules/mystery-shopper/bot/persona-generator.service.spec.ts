import { ServiceUnavailableException } from '@nestjs/common';
import { PersonaGeneratorService, pickMainAgent } from './persona-generator.service';
import {
  PERSONA_AGENT_MAX_CHARS,
  PERSONA_FAQ_MAX_CHARS,
  PERSONA_MAX_TOKENS,
  PERSONA_TEMPERATURE,
} from './persona-generator.constants';

const GOOD = 'Nome: Carla Mendes. Viaja com o marido (42) e os filhos (8 e 12) em julho; quer Magic Kingdom e Universal.';
const answer = (content: string) => ({ message: { content }, usage: { costUsd: 0.01 } });

function build() {
  const prisma = {
    aiAgent: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'a1', name: 'Augusto', kind: 'WORKER', systemPrompt: 'prompt worker', operationalContext: null, createdAt: new Date('2026-01-01'), _count: { channels: 0 } },
        { id: 'a2', name: 'Aline', kind: 'ORCHESTRATOR', systemPrompt: 'Você é a Aline, SDR.', operationalContext: 'Promo de julho.', createdAt: new Date('2026-02-01'), _count: { channels: 2 } },
      ]),
    },
    aiAgentKnowledge: {
      findMany: jest.fn().mockResolvedValue([{ question: 'Vende ingresso?', content: 'Sim, todos os parques.', category: 'ingressos' }]),
    },
    conversation: {
      groupBy: jest.fn().mockResolvedValue([
        { lostReason: 'NO_REPLY', _count: { _all: 3 } },
        { lostReason: 'PRICE', _count: { _all: 9 } },
      ]),
    },
  };
  const llm = { complete: jest.fn().mockResolvedValue(answer(JSON.stringify({ persona: GOOD }))) };
  const service = new PersonaGeneratorService(prisma as never, llm as never);
  return { service, prisma, llm };
}

describe('PersonaGeneratorService.generate', () => {
  it('chama a IA com o modelo da conversa, temperatura e teto de tokens e devolve a persona', async () => {
    const { service, llm } = build();
    await expect(service.generate('org', 'casal em julho')).resolves.toEqual({ persona: GOOD });
    expect(llm.complete).toHaveBeenCalledTimes(1);
    const call = llm.complete.mock.calls[0][0];
    expect(call).toMatchObject({ organizationId: 'org', temperature: PERSONA_TEMPERATURE, maxTokens: PERSONA_MAX_TOKENS });
    expect(call.modelId).toBeTruthy();
    const user = call.messages[1].content as string;
    expect(user).toContain('casal em julho');
    expect(user).toContain('P: Vende ingresso? R: Sim, todos os parques.');
    expect(user).toContain('Você é a Aline, SDR.');
    expect(user).toContain('Promo de julho.');
    expect(user).not.toContain('prompt worker');
    // Ordenado por quantidade, com rótulo legível.
    expect(user.indexOf('Preço / fora do orçamento (9)')).toBeLessThan(user.indexOf('Não respondeu (3)'));
  });

  it('ilegível na 1ª tentativa: tenta de novo com lembrete e aceita a 2ª', async () => {
    const { service, llm } = build();
    llm.complete.mockResolvedValueOnce(answer('desculpe, não consigo')).mockResolvedValueOnce(answer(`<think>ok</think>{"persona":${JSON.stringify(GOOD)}}`));
    await expect(service.generate('org', 'casal em julho')).resolves.toEqual({ persona: GOOD });
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(llm.complete.mock.calls[1][0].messages[1].content).toMatch(/tentativa anterior/i);
  });

  it('outro alfabeto duas vezes: erro amigável', async () => {
    const { service, llm } = build();
    llm.complete.mockResolvedValue(answer(JSON.stringify({ persona: 'Карла хочет поехать в Орландо в июле с семьёй' })));
    await expect(service.generate('org', 'casal em julho')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('erro da IA conta como tentativa e no fim vira erro amigável', async () => {
    const { service, llm } = build();
    llm.complete.mockRejectedValue(new Error('timeout'));
    await expect(service.generate('org', 'casal em julho')).rejects.toThrow('Não foi possível criar a persona agora. Tente de novo.');
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('contexto que falha ao carregar não derruba a geração', async () => {
    const { service, prisma, llm } = build();
    prisma.conversation.groupBy.mockRejectedValue(new Error('db'));
    prisma.aiAgentKnowledge.findMany.mockRejectedValue(new Error('db'));
    await expect(service.generate('org', 'casal em julho')).resolves.toEqual({ persona: GOOD });
    expect(llm.complete.mock.calls[0][0].messages[1].content).toContain('(sem dados)');
  });

  it('respeita os tetos de FAQ e de instruções do agente', async () => {
    const { service, prisma, llm } = build();
    prisma.aiAgentKnowledge.findMany.mockResolvedValue(
      Array.from({ length: 500 }, (_, i) => ({ question: `Pergunta ${i}?`, content: 'r'.repeat(80), category: 'geral' })),
    );
    prisma.aiAgent.findMany.mockResolvedValue([
      { id: 'a2', name: 'Aline', kind: 'ORCHESTRATOR', systemPrompt: 'S'.repeat(20_000), operationalContext: null, createdAt: new Date(), _count: { channels: 1 } },
    ]);
    await service.generate('org', 'casal em julho');
    const user = llm.complete.mock.calls[0][0].messages[1].content as string;
    expect(user.match(/S{100,}…/)![0].length).toBeLessThanOrEqual(PERSONA_AGENT_MAX_CHARS);
    expect(user).not.toContain('Pergunta 499?');
    const faqPart = (user.match(/^\[geral\] P: .*$/gm) ?? []).join('\n');
    expect(faqPart.length).toBeGreaterThan(0);
    expect(faqPart.length).toBeLessThanOrEqual(PERSONA_FAQ_MAX_CHARS);
  });

  it('busca FAQ e motivos só da org pedida (motivos: 90 dias, sem cliente oculto)', async () => {
    const { service, prisma } = build();
    const now = new Date('2026-11-14T12:00:00Z');
    await service.generate('org', 'casal em julho', now);
    expect(prisma.aiAgentKnowledge.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org' }) }));
    const where = prisma.conversation.groupBy.mock.calls[0][0].where;
    expect(where.organizationId).toBe('org');
    expect(where.contact).toEqual({ isMysteryShopper: false });
    expect(where.lostAt.gte.toISOString()).toBe('2026-08-16T12:00:00.000Z');
  });
});

describe('pickMainAgent', () => {
  const base = { systemPrompt: '', operationalContext: null, createdAt: new Date('2026-01-01') };
  it('prefere agente ligado a canal, depois orquestrador, depois mais canais, depois o mais antigo', () => {
    const agents = [
      { ...base, id: 'w0', name: 'Sem canal', kind: 'ORCHESTRATOR', _count: { channels: 0 } },
      { ...base, id: 'w1', name: 'Worker', kind: 'WORKER', _count: { channels: 5 } },
      { ...base, id: 'o1', name: 'Orq novo', kind: 'ORCHESTRATOR', createdAt: new Date('2026-03-01'), _count: { channels: 1 } },
      { ...base, id: 'o2', name: 'Orq antigo', kind: 'ORCHESTRATOR', _count: { channels: 1 } },
    ];
    expect(pickMainAgent(agents as never)?.id).toBe('o2');
  });

  it('nenhum agente: null', () => {
    expect(pickMainAgent([])).toBeNull();
  });
});
