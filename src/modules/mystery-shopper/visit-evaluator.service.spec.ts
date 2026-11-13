// src/modules/mystery-shopper/visit-evaluator.service.spec.ts
import { VisitEvaluatorService } from './visit-evaluator.service';

const VISIT = {
  id: 'v1',
  organizationId: 'org',
  conversationId: 'c1',
  status: 'EVALUATING' as const,
  scenario: 'família de 4',
  evaluatedAt: null as Date | null,
  assignedToId: 'u1',
  sellerUserId: null as string | null,
};
const MESSAGES = [
  { id: 'm1', direction: 'INBOUND' as const, senderId: null, isAutomated: false, text: 'Quero Orlando em julho', createdAt: new Date('2026-11-13T10:00:00Z') },
  { id: 'm2', direction: 'OUTBOUND' as const, senderId: 'u1', isAutomated: false, text: 'Quantas pessoas vão e quais as idades?', createdAt: new Date('2026-11-13T10:05:00Z') },
];
const CRITERIA = [{ name: 'ocultoDescoberta', description: 'Descoberta', instructions: 'Pergunta.' }];
const GOOD = JSON.stringify({
  notas: [{ criterio: 'ocultoDescoberta', nota: 2, trecho: 'Quantas pessoas vão e quais as idades?', comentario: 'ok' }],
  resumo: 'Bom.',
  fortes: ['Descoberta'],
  melhorar: [],
});
const reply = (text: string) => ({ message: { content: text }, usage: { costUsd: 0.01 }, rawModelId: 'm', stopReason: 'end' });

function setup(overrides: { visit?: typeof VISIT | null; messages?: typeof MESSAGES; llm?: jest.Mock } = {}) {
  const repository = {
    findVisitForEvaluation: jest.fn().mockResolvedValue(overrides.visit === undefined ? VISIT : overrides.visit),
    findMessages: jest.fn().mockResolvedValue(overrides.messages ?? MESSAGES),
    findFirstAssignment: jest.fn().mockResolvedValue(null),
    countProposals: jest.fn().mockResolvedValue(0),
    findUserNames: jest.fn().mockResolvedValue(new Map([['u1', 'Pedro']])),
    saveEvaluation: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
  };
  const criteria = {
    loadCriteria: jest.fn().mockResolvedValue(CRITERIA),
    loadProductRules: jest.fn().mockResolvedValue(null),
  };
  const llm = { complete: overrides.llm ?? jest.fn().mockResolvedValue(reply(GOOD)) };
  const notifier = { notifyDone: jest.fn().mockResolvedValue(undefined) };
  const service = new VisitEvaluatorService(repository as never, criteria as never, llm as never, notifier as never);
  return { service, repository, llm, notifier };
}

describe('VisitEvaluatorService', () => {
  test('avalia, grava DONE com a 1ª resposta medida por código e avisa', async () => {
    const { service, repository, notifier } = setup();

    expect(await service.evaluate('v1')).toBe('DONE');

    const saved = repository.saveEvaluation.mock.calls[0][1];
    expect(saved.sellerName).toBe('Pedro');
    expect(saved.scores.map((s: { criterion: string }) => s.criterion)).toEqual(['primeiraResposta', 'ocultoDescoberta']);
    expect(saved.totalScore).toBe(100);
    expect(notifier.notifyDone).toHaveBeenCalled();
  });

  test('tira <think> antes de ler o JSON', async () => {
    const llm = jest.fn().mockResolvedValue(reply(`<think>{"x":1}</think>${GOOD}`));
    const { service } = setup({ llm });
    expect(await service.evaluate('v1')).toBe('DONE');
  });

  test('ilegível duas vezes = FAILED, sem apagar avaliação anterior', async () => {
    const llm = jest.fn().mockResolvedValue(reply('???'));
    const { service, repository } = setup({ llm, visit: { ...VISIT, evaluatedAt: new Date() } });

    expect(await service.evaluate('v1')).toBe('FAILED');
    expect(llm).toHaveBeenCalledTimes(2);
    expect(repository.saveEvaluation).not.toHaveBeenCalled();
    expect(repository.recordFailure).toHaveBeenCalledWith('v1', expect.any(String), true);
  });

  test('vendedor calado: nota zero sem chamar a IA', async () => {
    const { service, llm, repository } = setup({ messages: [MESSAGES[0]] });
    expect(await service.evaluate('v1')).toBe('DONE');
    expect(llm.complete).not.toHaveBeenCalled();
    expect(repository.saveEvaluation.mock.calls[0][1].totalScore).toBe(0);
  });

  test('reavaliação mantém o vendedor já gravado, não o dono atual', async () => {
    const messages = MESSAGES.map((m) => (m.senderId === 'u1' ? { ...m, senderId: 'u9' } : m));
    const { service, repository } = setup({
      visit: { ...VISIT, evaluatedAt: new Date(), sellerUserId: 'u9' },
      messages,
    });

    expect(await service.evaluate('v1')).toBe('DONE');
    expect(repository.saveEvaluation.mock.calls[0][1].sellerUserId).toBe('u9');
  });

  test('visita que não está em EVALUATING é ignorada', async () => {
    const { service } = setup({ visit: { ...VISIT, status: 'DONE' as never } });
    expect(await service.evaluate('v1')).toBe('SKIPPED');
  });
});
