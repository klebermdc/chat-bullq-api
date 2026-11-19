import { TeamPulseThrottle } from './team-pulse.throttle';

describe('TeamPulseThrottle', () => {
  it('libera a primeira vez e segura a repetição na mesma org, dia e hora', async () => {
    // Arrange
    const keys = new Set<string>();
    const store = {
      set: jest.fn(async (key: string) => (keys.has(key) ? null : (keys.add(key), 'OK'))),
    };
    const throttle = new TeamPulseThrottle(async () => store);
    // Act
    const first = await throttle.claimHour('org1', '2026-11-19', 15);
    const again = await throttle.claimHour('org1', '2026-11-19', 15);
    const nextHour = await throttle.claimHour('org1', '2026-11-19', 16);
    // Assert
    expect([first, again, nextHour]).toEqual([true, false, true]);
    expect(store.set).toHaveBeenCalledWith('pulso-equipe:org1:2026-11-19:15', '1', 'PX', expect.any(Number), 'NX');
  });
});
