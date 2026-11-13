import { ManagerBotRepository } from './manager-bot.repository';

const RANGE = { from: new Date('2026-11-10T03:00:00Z'), to: new Date('2026-11-11T03:00:00Z') };
const REAL = { isMysteryShopper: false };

function setup() {
  const count = jest.fn().mockResolvedValue(0);
  const groupBy = jest.fn().mockResolvedValue([]);
  const repository = new ManagerBotRepository({
    conversation: { count, groupBy },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  } as never);
  return { repository, count, groupBy };
}

describe('ManagerBotRepository — cliente oculto fica de fora', () => {
  test('entradas e fechamentos', async () => {
    const { repository, count } = setup();
    await repository.countEntered('org', RANGE);
    await repository.countClosed('org', RANGE);
    expect(count.mock.calls[0][0].where.contact).toEqual(REAL);
    expect(count.mock.calls[1][0].where.contact).toEqual(REAL);
  });

  test('perdidas por motivo e por vendedor', async () => {
    const { repository, groupBy } = setup();
    await repository.lostByReason('org', RANGE);
    await repository.lostByAgent('org', RANGE);
    expect(groupBy.mock.calls[0][0].where.contact).toEqual(REAL);
    expect(groupBy.mock.calls[1][0].where.contact).toEqual(REAL);
  });
});
