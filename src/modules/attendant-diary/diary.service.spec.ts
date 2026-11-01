import { DiaryService } from './diary.service';
import type { DiaryMessage } from './diary.types';

const JOB = { organizationId: 'org', userId: 'u1', day: '2026-10-30' };
const dayMessages: DiaryMessage[] = [
  { conversationId: 'c1', direction: 'INBOUND', senderId: null, text: 'Oi', at: new Date('2026-10-30T13:00:00Z') },
  { conversationId: 'c1', direction: 'OUTBOUND', senderId: 'u1', text: 'Quais são as datas da viagem?', at: new Date('2026-10-30T13:05:00Z') },
];
const criteria = {
  criteria: [{ name: 'diarioDiagnostico', description: 'd', instructions: 'i' }],
  versions: { diarioDiagnostico: 1 },
};
const llmAnswer = (content: string) => ({
  message: { role: 'assistant', content },
  usage: { costUsd: 0.01 },
  rawModelId: 'MiniMax',
});

function setup(overrides: { existing?: object | null; messages?: DiaryMessage[] } = {}) {
  const repository = {
    findDiary: jest.fn().mockResolvedValue(overrides.existing ?? null),
    findMember: jest.fn().mockResolvedValue({ name: 'Bárbara', workingHours: null, timeZone: 'America/Sao_Paulo' }),
    findDayMessages: jest.fn().mockResolvedValue(overrides.messages ?? dayMessages),
    findContextMessages: jest.fn().mockResolvedValue([]),
    findOnlineMinutes: jest.fn().mockResolvedValue(300),
    saveDiary: jest.fn().mockResolvedValue(undefined),
  };
  const llm = { complete: jest.fn() };
  const criteriaService = { loadCriteria: jest.fn().mockResolvedValue(criteria) };
  const service = new DiaryService(repository as never, criteriaService as never, llm as never);
  return { service, repository, llm, criteriaService };
}

describe('DiaryService.generate', () => {
  test('não refaz (nem paga de novo) um dia já avaliado', async () => {
    const { service, llm, repository } = setup({ existing: { status: 'READY' } });

    const result = await service.generate(JOB);

    expect(result).toBe('SKIPPED');
    expect(llm.complete).not.toHaveBeenCalled();
    expect(repository.saveDiary).not.toHaveBeenCalled();
  });

  test('force refaz o dia já avaliado', async () => {
    const { service, llm } = setup({ existing: { status: 'READY' } });
    llm.complete.mockResolvedValue(llmAnswer('{"resumo":"ok"}'));

    await expect(service.generate({ ...JOB, force: true })).resolves.toBe('READY');
  });

  test('dia sem atendimento salva EMPTY sem chamar a IA', async () => {
    const { service, llm, repository } = setup({ messages: [] });

    const result = await service.generate(JOB);

    expect(result).toBe('EMPTY');
    expect(llm.complete).not.toHaveBeenCalled();
    expect(repository.saveDiary).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'EMPTY', conversationsAnalyzed: 0 }),
    );
  });

  test('avaliação válida salva READY com métricas, custo e versão dos critérios', async () => {
    const { service, llm, repository } = setup();
    llm.complete.mockResolvedValue(
      llmAnswer(JSON.stringify({
        resumo: 'Bom dia.',
        acertos: [{ criterio: 'diarioDiagnostico', titulo: 'Perguntou as datas', explicacao: 'Bom.', conversa: 'C1', trecho: 'Quais são as datas da viagem?' }],
        melhorias: [],
      })),
    );

    const result = await service.generate(JOB);

    expect(result).toBe('READY');
    expect(repository.saveDiary).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'READY',
        summary: 'Bom dia.',
        costUsd: 0.01,
        conversationsAnalyzed: 1,
        criteriaVersions: { diarioDiagnostico: 1 },
        metrics: expect.objectContaining({ conversations: 1, medianReplyMinutes: 5, onlineMinutes: 300 }),
      }),
    );
  });

  test('falha da IA salva FAILED e preserva as métricas', async () => {
    const { service, llm, repository } = setup();
    llm.complete.mockRejectedValue(new Error('timeout'));

    const result = await service.generate(JOB);

    expect(result).toBe('FAILED');
    expect(repository.saveDiary).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        errorMessage: 'timeout',
        metrics: expect.objectContaining({ conversations: 1 }),
      }),
    );
  });

  test('resposta ilegível da IA salva FAILED e registra o custo gasto', async () => {
    const { service, llm, repository } = setup();
    llm.complete.mockResolvedValue(llmAnswer('desculpe, não consigo'));

    const result = await service.generate(JOB);

    expect(result).toBe('FAILED');
    expect(repository.saveDiary).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'FAILED', costUsd: 0.01 }),
    );
  });

  test('não avalia sem nenhum critério ativo', async () => {
    const { service, llm, criteriaService } = setup();
    criteriaService.loadCriteria.mockResolvedValue({ criteria: [], versions: {} });

    const result = await service.generate(JOB);

    expect(result).toBe('FAILED');
    expect(llm.complete).not.toHaveBeenCalled();
  });

  test('membro fora da organização não gera diário', async () => {
    const { service, repository } = setup();
    repository.findMember.mockResolvedValue(null);

    await expect(service.generate(JOB)).resolves.toBe('SKIPPED');
    expect(repository.saveDiary).not.toHaveBeenCalled();
  });
});
