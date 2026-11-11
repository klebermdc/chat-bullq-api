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
    findContactNames: jest.fn().mockResolvedValue(new Map([['c1', 'Ana Souza']])),
    saveDiary: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
  };
  const llm = { complete: jest.fn() };
  const criteriaService = { loadCriteria: jest.fn().mockResolvedValue(criteria) };
  const service = new DiaryService(repository as never, criteriaService as never, llm as never);
  return { service, repository, llm, criteriaService };
}

const elevenConversations = (): DiaryMessage[] =>
  Array.from({ length: 11 }, (_, i) => ({
    conversationId: `c${i + 1}`,
    direction: 'OUTBOUND' as const,
    senderId: 'u1',
    text: `Mensagem da conversa número ${i + 1}`,
    at: new Date('2026-10-30T13:00:00Z'),
  }));

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

  test('falha ao gerar de novo não apaga o diário que já estava pronto', async () => {
    const { service, llm, repository } = setup({ existing: { status: 'READY' } });
    llm.complete.mockResolvedValue(llmAnswer('não sei'));

    const result = await service.generate({ ...JOB, force: true });

    expect(result).toBe('FAILED');
    expect(repository.saveDiary).not.toHaveBeenCalled();
    expect(repository.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ day: JOB.day, errorMessage: expect.any(String), costUsd: 0.02 }),
    );
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

  test('guarda foco, avaliação com nome do cliente e clientes sem resposta', async () => {
    const waiting: DiaryMessage = {
      conversationId: 'c1', direction: 'INBOUND', senderId: null, text: 'Alô?', at: new Date('2026-10-30T14:00:00Z'),
    };
    const { service, llm, repository } = setup({ messages: [...dayMessages, waiting] });
    llm.complete.mockResolvedValue(
      llmAnswer(JSON.stringify({
        resumo: 'Bom dia.',
        foco: 'Responder a Ana.',
        conversas: [{ conversa: 'C1', assunto: 'Datas', avaliacao: 'Boa.' }],
      })),
    );

    await service.generate(JOB);

    expect(repository.saveDiary).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          focus: 'Responder a Ana.',
          conversations: [expect.objectContaining({ conversationId: 'c1', contactName: 'Ana Souza', topic: 'Datas' })],
          pending: [{ conversationId: 'c1', contactName: 'Ana Souza', waitingSince: '2026-10-30T14:00:00.000Z' }],
        }),
      }),
    );
  });

  test('refaz uma vez quando a IA mistura outro idioma e soma o custo', async () => {
    const { service, llm, repository } = setup();
    llm.complete
      .mockResolvedValueOnce(llmAnswer(JSON.stringify({ resumo: 'Ajuste é 直接 responder.' })))
      .mockResolvedValueOnce(llmAnswer(JSON.stringify({ resumo: 'Ajuste é responder direto.' })));

    await expect(service.generate(JOB)).resolves.toBe('READY');

    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(repository.saveDiary).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Ajuste é responder direto.', costUsd: 0.02 }),
    );
  });

  test('outro idioma que persiste é tirado do texto e o diário sai', async () => {
    const { service, llm, repository } = setup();
    llm.complete.mockResolvedValue(llmAnswer(JSON.stringify({ resumo: 'Ajuste é 直接 responder.' })));

    await expect(service.generate(JOB)).resolves.toBe('READY');

    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(repository.saveDiary).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'READY', summary: 'Ajuste é responder.' }),
    );
  });

  test('ignora o raciocínio <think> do modelo, mesmo com chaves dentro', async () => {
    const { service, llm, repository } = setup();
    llm.complete.mockResolvedValue(
      llmAnswer('<think>The user wants {json}. Let me plan {a: 1}.</think>\n{"resumo":"Bom dia de trabalho."}'),
    );

    await expect(service.generate(JOB)).resolves.toBe('READY');

    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(repository.saveDiary).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Bom dia de trabalho.' }),
    );
  });

  test('avalia todas as conversas do dia em blocos e junta no final', async () => {
    const messages: DiaryMessage[] = Array.from({ length: 11 }, (_, i) => ({
      conversationId: `c${i + 1}`,
      direction: 'OUTBOUND' as const,
      senderId: 'u1',
      text: `Mensagem da conversa número ${i + 1}`,
      at: new Date('2026-10-30T13:00:00Z'),
    }));
    const { service, llm, repository } = setup({ messages });
    const batch = (refs: number[]) =>
      llmAnswer(JSON.stringify({
        resumo: 'Parcial.',
        conversas: refs.map((ref) => ({ conversa: `C${ref}`, assunto: 'A', avaliacao: 'Boa.' })),
      }));
    llm.complete
      .mockResolvedValueOnce(batch([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
      .mockResolvedValueOnce(batch([11]))
      .mockResolvedValueOnce(llmAnswer(JSON.stringify({ resumo: 'Dia inteiro.', foco: 'Foco final.' })));

    await expect(service.generate(JOB)).resolves.toBe('READY');

    expect(llm.complete).toHaveBeenCalledTimes(3);
    const saved = repository.saveDiary.mock.calls[0][0];
    expect(saved.summary).toBe('Dia inteiro.');
    expect(saved.conversationsAnalyzed).toBe(11);
    expect(saved.details.conversations).toHaveLength(11);
    expect(saved.details.focus).toBe('Foco final.');
    expect(saved.costUsd).toBeCloseTo(0.03);
  });

  test('bloco que falha fica de fora e o resto do dia é publicado', async () => {
    const { service, llm, repository } = setup({ messages: elevenConversations() });
    llm.complete
      .mockResolvedValueOnce(llmAnswer(JSON.stringify({ resumo: 'Parcial.' })))
      .mockRejectedValueOnce(new Error('timeout'));

    await expect(service.generate(JOB)).resolves.toBe('READY');

    expect(repository.saveDiary).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'READY', summary: 'Parcial.', conversationsAnalyzed: 10 }),
    );
  });

  test('todos os blocos falhando salva FAILED', async () => {
    const { service, llm, repository } = setup({ messages: elevenConversations() });
    llm.complete.mockRejectedValue(new Error('timeout'));

    await expect(service.generate(JOB)).resolves.toBe('FAILED');

    expect(repository.saveDiary).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'FAILED', errorMessage: 'timeout' }),
    );
  });

  test('consolidação ilegível junta os blocos sem a IA', async () => {
    const { service, llm, repository } = setup({ messages: elevenConversations() });
    llm.complete
      .mockResolvedValueOnce(llmAnswer(JSON.stringify({ resumo: 'Manhã boa.', foco: 'Responder rápido.' })))
      .mockResolvedValueOnce(llmAnswer(JSON.stringify({ resumo: 'Tarde boa.' })))
      .mockResolvedValue(llmAnswer('não sei'));

    await expect(service.generate(JOB)).resolves.toBe('READY');

    const saved = repository.saveDiary.mock.calls[0][0];
    expect(saved.status).toBe('READY');
    expect(saved.summary).toBe('Manhã boa. Tarde boa.');
    expect(saved.details.focus).toBe('Responder rápido.');
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

  test('resposta ilegível tenta de novo e só então salva FAILED com o custo gasto', async () => {
    const { service, llm, repository } = setup();
    llm.complete.mockResolvedValue(llmAnswer('desculpe, não consigo'));

    const result = await service.generate(JOB);

    expect(result).toBe('FAILED');
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(repository.saveDiary).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'FAILED', costUsd: 0.02 }),
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
