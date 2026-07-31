import { HealthService } from './health.service';

function makeService(over: { sql?: jest.Mock; ping?: jest.Mock } = {}) {
  const prisma = {
    $queryRaw: over.sql ?? jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  };
  const redis = { ping: over.ping ?? jest.fn().mockResolvedValue('PONG') };
  return new HealthService(prisma as never, redis as never);
}

describe('HealthService', () => {
  it('devolve ok quando banco e redis respondem', async () => {
    await expect(makeService().check()).resolves.toEqual({
      status: 'ok',
      checks: { db: 'ok', redis: 'ok' },
    });
  });

  it('devolve degraded quando o banco falha', async () => {
    const service = makeService({
      sql: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    await expect(service.check()).resolves.toEqual({
      status: 'degraded',
      checks: { db: 'fail', redis: 'ok' },
    });
  });

  it('devolve degraded quando o redis falha', async () => {
    const service = makeService({
      ping: jest.fn().mockRejectedValue(new Error('timeout')),
    });
    await expect(service.check()).resolves.toEqual({
      status: 'degraded',
      checks: { db: 'ok', redis: 'fail' },
    });
  });

  it('nao pendura: check que nao responde vira fail em 2s', async () => {
    jest.useFakeTimers();
    const service = makeService({
      sql: jest.fn().mockImplementation(() => new Promise(() => undefined)),
    });
    const promise = service.check();
    jest.advanceTimersByTime(2100);
    await expect(promise).resolves.toEqual({
      status: 'degraded',
      checks: { db: 'fail', redis: 'ok' },
    });
    jest.useRealTimers();
  });
});
