import { ManagerAlertsThrottle, type ThrottleStore } from './manager-alerts.throttle';

/** Redis falso: SET NX PX com relógio controlado. */
function fakeStore(clock: { now: number }): ThrottleStore {
  const keys = new Map<string, number>();
  return {
    async set(key, _value, _px, ttlMs, _nx) {
      const expiresAt = keys.get(key);
      if (expiresAt !== undefined && expiresAt > clock.now) return null;
      keys.set(key, clock.now + ttlMs);
      return 'OK';
    },
  };
}

const withStore = (store: ThrottleStore) => new ManagerAlertsThrottle(async () => store);

describe('ManagerAlertsThrottle', () => {
  it('libera o primeiro resumo e segura os seguintes dentro do intervalo', async () => {
    const clock = { now: 0 };
    const throttle = withStore(fakeStore(clock));
    expect(await throttle.claimDigest('org1', 30)).toBe(true);
    clock.now = 29 * 60_000;
    expect(await throttle.claimDigest('org1', 30)).toBe(false);
    clock.now = 30 * 60_000;
    expect(await throttle.claimDigest('org1', 30)).toBe(true);
  });

  it('o intervalo é por org', async () => {
    const clock = { now: 0 };
    const throttle = withStore(fakeStore(clock));
    expect(await throttle.claimDigest('org1', 30)).toBe(true);
    expect(await throttle.claimDigest('org2', 30)).toBe(true);
  });

  it('o placar sai uma vez por dia local', async () => {
    const clock = { now: 0 };
    const throttle = withStore(fakeStore(clock));
    expect(await throttle.claimScoreboard('org1', '2026-11-09')).toBe(true);
    expect(await throttle.claimScoreboard('org1', '2026-11-09')).toBe(false);
    expect(await throttle.claimScoreboard('org1', '2026-11-10')).toBe(true);
  });
});
