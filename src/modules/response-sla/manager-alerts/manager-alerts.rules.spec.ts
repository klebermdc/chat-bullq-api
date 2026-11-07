import { isQuietHours, isScoreboardDue, localDateKey, localDayStart } from './manager-alerts.rules';

const TZ = 'America/Sao_Paulo';
const sp = (isoLocal: string) => new Date(`${isoLocal}-03:00`);

describe('isQuietHours (22:30–08:00 local)', () => {
  it.each([
    ['2026-11-09T22:29:00', false],
    ['2026-11-09T22:30:00', true],
    ['2026-11-09T23:59:00', true],
    ['2026-11-10T00:00:00', true],
    ['2026-11-10T07:59:00', true],
    ['2026-11-10T08:00:00', false],
    ['2026-11-10T14:00:00', false],
  ])('%s → %s', (local, expected) => {
    expect(isQuietHours(sp(local), TZ)).toBe(expected);
  });
});

describe('isScoreboardDue', () => {
  const at2210 = 22 * 60 + 10;
  it('dispara a partir do horário configurado', () => {
    expect(isScoreboardDue(sp('2026-11-09T22:10:00'), TZ, at2210)).toBe(true);
    expect(isScoreboardDue(sp('2026-11-09T22:14:59'), TZ, at2210)).toBe(true);
  });
  it('não dispara antes', () => {
    expect(isScoreboardDue(sp('2026-11-09T22:09:00'), TZ, at2210)).toBe(false);
  });
  it('ainda recupera um tique perdido dentro de 1h, mas não depois', () => {
    expect(isScoreboardDue(sp('2026-11-09T23:09:00'), TZ, at2210)).toBe(true);
    expect(isScoreboardDue(sp('2026-11-09T23:10:00'), TZ, at2210)).toBe(false);
  });
});

describe('localDateKey / localDayStart', () => {
  it('usa o dia local, não o UTC', () => {
    // 23:30 em SP já é dia seguinte em UTC.
    expect(localDateKey(sp('2026-11-09T23:30:00'), TZ)).toBe('2026-11-09');
  });
  it('início do dia local é meia-noite em SP', () => {
    expect(localDayStart(sp('2026-11-09T15:42:31'), TZ).toISOString()).toBe(
      sp('2026-11-09T00:00:00').toISOString(),
    );
  });
});
