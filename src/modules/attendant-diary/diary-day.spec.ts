import { dayRange, isValidDay, previousDayKey } from './diary-day';

const TZ = 'America/Sao_Paulo';

describe('diary-day', () => {
  test('o dia em São Paulo começa às 03h UTC', () => {
    const { from, to } = dayRange('2026-10-30', TZ);

    expect(from.toISOString()).toBe('2026-10-30T03:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-31T03:00:00.000Z');
  });

  test('às 6h de domingo em São Paulo, ontem é sábado', () => {
    expect(previousDayKey(new Date('2026-11-01T09:00:00Z'), TZ)).toBe('2026-10-31');
  });

  test('às 23h locais, ontem respeita o fuso e não o UTC', () => {
    expect(previousDayKey(new Date('2026-11-01T02:00:00Z'), TZ)).toBe('2026-10-30');
  });

  test('recusa dia que não existe no calendário', () => {
    expect(isValidDay('2026-10-30')).toBe(true);
    expect(isValidDay('2026-13-45')).toBe(false);
    expect(isValidDay('2026-02-31')).toBe(false);
  });
});
