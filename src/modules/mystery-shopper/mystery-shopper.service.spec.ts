import { NotFoundException } from '@nestjs/common';
import { MysteryShopperService } from './mystery-shopper.service';

const NOW = new Date('2026-11-16T12:00:00Z');
const NUMBER = { id: 'n1', organizationId: 'org', contactId: 'k1', createdAt: new Date('2026-11-01T00:00:00Z') };

function setup() {
  const repository = {
    findActiveNumbers: jest.fn().mockResolvedValue([NUMBER]),
    findConversationsWithoutVisit: jest.fn().mockResolvedValue(['c1', 'c2']),
    createVisit: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    findDueOpenVisitIds: jest.fn().mockResolvedValue(['v1']),
    markEvaluating: jest.fn().mockResolvedValue(true),
    findVisit: jest.fn(),
    findUserNames: jest.fn().mockResolvedValue(new Map()),
    findMessages: jest.fn().mockResolvedValue([]),
  };
  const queue = { add: jest.fn().mockResolvedValue({}) };
  const service = new MysteryShopperService(repository as never, queue as never);
  return { service, repository, queue };
}

describe('MysteryShopperService.sweep', () => {
  test('abre visitas novas e manda avaliar as paradas há 72h', async () => {
    const { service, repository, queue } = setup();

    const result = await service.sweep(NOW);

    expect(result).toEqual({ opened: 1, queued: 1 });
    expect(repository.findDueOpenVisitIds).toHaveBeenCalledWith(new Date('2026-11-13T12:00:00Z'));
    expect(repository.markEvaluating).toHaveBeenCalledWith({ id: 'v1', from: ['OPEN'], closedAt: NOW });
    expect(queue.add).toHaveBeenCalledWith('evaluate', { visitId: 'v1' }, expect.objectContaining({ jobId: 'mystery-eval-v1' }));
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
});
