import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MysteryShopperRepository } from './mystery-shopper.repository';

const NUMBER = { id: 'n1', organizationId: 'org', contactId: 'k1', createdAt: new Date('2026-11-13T00:00:00Z') };

describe('MysteryShopperRepository', () => {
  test('visita duplicada (corrida entre varreduras) é ignorada', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6' });
    const repository = new MysteryShopperRepository({
      mysteryShopperVisit: { create: jest.fn().mockRejectedValue(duplicate) },
    } as never);
    await expect(repository.createVisit(NUMBER, 'c1')).resolves.toBe(false);
  });

  test('só conversas criadas depois do cadastro e sem visita', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'c1' }]);
    const repository = new MysteryShopperRepository({ conversation: { findMany } } as never);

    expect(await repository.findConversationsWithoutVisit(NUMBER)).toEqual(['c1']);
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      contactId: 'k1',
      createdAt: { gte: NUMBER.createdAt },
      mysteryShopperVisit: { is: null },
    });
  });

  test('visitas paradas: EVALUATING com updatedAt antes do limite', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'v1' }]);
    const repository = new MysteryShopperRepository({ mysteryShopperVisit: { findMany } } as never);
    const before = new Date('2026-11-16T11:30:00Z');

    expect(await repository.findStuckEvaluatingIds(before)).toEqual(['v1']);
    expect(findMany.mock.calls[0][0].where).toEqual({ status: 'EVALUATING', updatedAt: { lt: before } });
  });

  test.each([
    ['sem custo anterior', null, '0.02'],
    ['soma ao custo anterior', new Prisma.Decimal('0.0123'), '0.0323'],
  ])('salvar avaliação: %s', async (_name, previous, expected) => {
    const findUnique = jest.fn().mockResolvedValue({ costUsd: previous });
    const update = jest.fn().mockResolvedValue({});
    const repository = new MysteryShopperRepository({ mysteryShopperVisit: { findUnique, update } } as never);

    await repository.saveEvaluation('v1', {
      sellerUserId: 'u1',
      sellerName: 'Pedro',
      metrics: {},
      scores: [],
      totalScore: 80,
      summary: {},
      costUsd: 0.02,
    } as never);

    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('DONE');
    expect(data.costUsd.toString()).toBe(expected);
  });

  test('cadastro reaproveita o contato pelo telefone (com e sem o 9) e marca sem nome', async () => {
    const tx = {
      contact: {
        findFirst: jest.fn().mockResolvedValue({ id: 'k1' }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'k1' }),
      },
      mysteryShopperNumber: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'n1', label: 'Chip', createdAt: new Date(), contact: { phone: '5511982015967' } }),
      },
    };
    const repository = new MysteryShopperRepository({ $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as never);

    await repository.addNumber('org', '5511982015967', 'Chip', 'u1');

    expect(tx.contact.findFirst.mock.calls[0][0].where.phone.in).toEqual(['5511982015967', '551182015967']);
    expect(tx.contact.create).not.toHaveBeenCalled();
    expect(tx.contact.update.mock.calls[0][0].data).toEqual({ isMysteryShopper: true });
  });

  test('número já ativo = conflito', async () => {
    const tx = {
      contact: { findFirst: jest.fn().mockResolvedValue({ id: 'k1' }), create: jest.fn(), update: jest.fn() },
      mysteryShopperNumber: { findFirst: jest.fn().mockResolvedValue({ id: 'n0' }), create: jest.fn() },
    };
    const repository = new MysteryShopperRepository({ $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as never);
    await expect(repository.addNumber('org', '5511982015967', 'Chip', 'u1')).rejects.toBeInstanceOf(ConflictException);
  });
});
