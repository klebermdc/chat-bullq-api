import { BadRequestException, NotFoundException } from '@nestjs/common';
import { evaluateJobOptions } from './mystery-shopper.constants';
import { MysteryShopperService } from './mystery-shopper.service';

const NOW = new Date('2026-11-16T12:00:00Z');
const NUMBER = { id: 'n1', organizationId: 'org', contactId: 'k1', createdAt: new Date('2026-11-01T00:00:00Z') };

function setup() {
  const repository = {
    findActiveNumbers: jest.fn().mockResolvedValue([NUMBER]),
    findConversationsWithoutVisit: jest.fn().mockResolvedValue(['c1', 'c2']),
    createVisit: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    findDueOpenVisitIds: jest.fn().mockResolvedValue(['v1']),
    findStuckEvaluatingIds: jest.fn().mockResolvedValue([]),
    markEvaluating: jest.fn().mockResolvedValue(true),
    findVisit: jest.fn(),
    findUserNames: jest.fn().mockResolvedValue(new Map()),
    findMessages: jest.fn().mockResolvedValue([]),
    findOrgTimezone: jest.fn().mockResolvedValue('America/Sao_Paulo'),
    findKpiVisits: jest.fn().mockResolvedValue([]),
    countOpenVisits: jest.fn().mockResolvedValue(0),
  };
  const queue = { add: jest.fn().mockResolvedValue({}) };
  const service = new MysteryShopperService(repository as never, queue as never);
  return { service, repository, queue };
}

describe('MysteryShopperService.sweep', () => {
  test('abre visitas novas e manda avaliar as paradas há 72h', async () => {
    const { service, repository, queue } = setup();

    const result = await service.sweep(NOW);

    expect(result).toEqual({ opened: 1, queued: 1, requeued: 0 });
    expect(repository.findDueOpenVisitIds).toHaveBeenCalledWith(new Date('2026-11-13T12:00:00Z'));
    expect(repository.markEvaluating).toHaveBeenCalledWith({ id: 'v1', from: ['OPEN'], closedAt: NOW });
    expect(queue.add).toHaveBeenCalledWith('evaluate', { visitId: 'v1' }, expect.objectContaining({ jobId: expect.stringMatching(/^mystery-eval-v1-\d+$/) }));
  });

  test('reenfileira visitas paradas em EVALUATING há mais de 30 min', async () => {
    const { service, repository, queue } = setup();
    repository.findDueOpenVisitIds.mockResolvedValue([]);
    repository.findStuckEvaluatingIds.mockResolvedValue(['v7']);

    const result = await service.sweep(NOW);

    expect(repository.findStuckEvaluatingIds).toHaveBeenCalledWith(new Date('2026-11-16T11:30:00Z'));
    expect(result.requeued).toBe(1);
    expect(queue.add).toHaveBeenCalledWith('evaluate', { visitId: 'v7' }, expect.anything());
    expect(repository.markEvaluating).not.toHaveBeenCalled();
  });

  test('um número com erro não derruba a varredura', async () => {
    const { service, repository, queue } = setup();
    const second = { ...NUMBER, id: 'n2' };
    repository.findActiveNumbers.mockResolvedValue([NUMBER, second]);
    repository.findConversationsWithoutVisit.mockResolvedValue(['c1']);
    repository.createVisit.mockReset().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(true);

    const result = await service.sweep(NOW);

    expect(result).toEqual({ opened: 1, queued: 1, requeued: 0 });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  test('uma visita com erro no enqueue não impede as seguintes', async () => {
    const { service, repository, queue } = setup();
    repository.findDueOpenVisitIds.mockResolvedValue(['v1', 'v2']);
    queue.add.mockRejectedValueOnce(new Error('redis')).mockResolvedValueOnce({});

    const result = await service.sweep(NOW);

    expect(result.queued).toBe(1);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });
});

describe('evaluateJobOptions', () => {
  test('dois enfileiramentos da mesma visita têm jobIds diferentes', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(1000);
      const first = evaluateJobOptions('v1').jobId;
      jest.setSystemTime(1001);
      expect(evaluateJobOptions('v1').jobId).not.toBe(first);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('MysteryShopperService.requestEvaluation', () => {
  test('visita de outra org = 404', async () => {
    const { service, repository } = setup();
    repository.findVisit.mockResolvedValue(null);
    await expect(service.requestEvaluation('org', 'v9', NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  test('reavaliar mantém a data de fechamento original', async () => {
    const { service, repository, queue } = setup();
    const closedAt = new Date('2026-11-14T00:00:00Z');
    repository.findVisit.mockResolvedValue({ id: 'v1', status: 'DONE', closedAt });

    await service.requestEvaluation('org', 'v1', NOW);

    expect(repository.markEvaluating).toHaveBeenCalledWith({ id: 'v1', organizationId: 'org', from: ['DONE'], closedAt });
    expect(queue.add).toHaveBeenCalled();
  });

  test('falha no enqueue sobe o erro (a varredura recupera a visita depois)', async () => {
    const { service, repository, queue } = setup();
    repository.findVisit.mockResolvedValue({ id: 'v1', status: 'OPEN', closedAt: null });
    queue.add.mockRejectedValue(new Error('redis'));
    await expect(service.requestEvaluation('org', 'v1', NOW)).rejects.toThrow('redis');
  });
});

describe('MysteryShopperService.kpis', () => {
  const kpiVisit = (id: string, sellerUserId: string | null, totalScore: number, evaluatedAt: string) => ({
    id,
    sellerUserId,
    totalScore,
    scores: [],
    improvements: [],
    evaluatedAt: new Date(evaluatedAt),
    metrics: { firstHumanReplyMinutes: 5, humanMessages: 2, followUps: 0, firstFollowUpHours: null, proposalSent: false, lastShopperMessageAt: null },
  });

  test('mês no fuso da org: separa mês atual e anterior, busca nomes e abertas', async () => {
    const { service, repository } = setup();
    repository.findKpiVisits.mockResolvedValue([
      kpiVisit('old', 'u2', 50, '2026-10-20T12:00:00Z'),
      kpiVisit('new', 'u1', 80, '2026-11-05T12:00:00Z'),
      kpiVisit('anon', null, 60, '2026-11-06T12:00:00Z'),
    ]);
    repository.countOpenVisits.mockResolvedValue(2);
    repository.findUserNames.mockResolvedValue(new Map([['u1', 'Pedro']]));

    const kpis = await service.kpis('org', '2026-11', NOW);

    const start = new Date('2026-11-01T03:00:00Z');
    const end = new Date('2026-12-01T03:00:00Z');
    expect(repository.findKpiVisits).toHaveBeenCalledWith('org', new Date('2026-10-01T03:00:00Z'), end);
    expect(repository.countOpenVisits).toHaveBeenCalledWith('org', start, end);
    expect(repository.findUserNames).toHaveBeenCalledWith(['u1']);
    expect(kpis.month).toBe('2026-11');
    expect(kpis.overall).toMatchObject({ visits: 2, openVisits: 2, averageScore: 70, previousAverageScore: 50 });
    expect(kpis.sellers).toEqual([expect.objectContaining({ sellerName: 'Pedro', previousAverageScore: null })]);
  });

  test('sem mês: mês atual no fuso da org', async () => {
    const { service } = setup();
    expect((await service.kpis('org', undefined, NOW)).month).toBe('2026-11');
  });

  test('mês inválido = 400 sem consultar visitas', async () => {
    const { service, repository } = setup();
    await expect(service.kpis('org', '2026-13', NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.findKpiVisits).not.toHaveBeenCalled();
  });
});
