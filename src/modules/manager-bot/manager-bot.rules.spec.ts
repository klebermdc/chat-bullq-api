import { isMonday, isReportDue, previousWeeks } from './manager-bot.rules';

const TZ = 'America/Sao_Paulo';
// 11/11/2026 é quarta-feira; São Paulo é UTC-3 (sem horário de verão).
const at = (iso: string) => new Date(iso);

describe('isReportDue', () => {
  it('não sai antes do horário', () => {
    expect(isReportDue(at('2026-11-11T11:55:00Z'), TZ, 540)).toBe(false); // 08:55
  });
  it('sai no horário e até 60 min depois (tique perdido)', () => {
    expect(isReportDue(at('2026-11-11T12:00:00Z'), TZ, 540)).toBe(true); // 09:00
    expect(isReportDue(at('2026-11-11T12:59:00Z'), TZ, 540)).toBe(true); // 09:59
    expect(isReportDue(at('2026-11-11T13:00:00Z'), TZ, 540)).toBe(false); // 10:00
  });
});

describe('isMonday', () => {
  it('usa o dia local', () => {
    expect(isMonday(at('2026-11-16T12:00:00Z'), TZ)).toBe(true);
    // domingo 23:30 em SP já é segunda em UTC
    expect(isMonday(at('2026-11-16T02:30:00Z'), TZ)).toBe(false);
  });
});

describe('previousWeeks', () => {
  it('na segunda devolve a semana anterior e a outra, de segunda a segunda local', () => {
    const { last, before } = previousWeeks(at('2026-11-16T12:05:00Z'), TZ);
    expect(last.from.toISOString()).toBe('2026-11-09T03:00:00.000Z');
    expect(last.to.toISOString()).toBe('2026-11-16T03:00:00.000Z');
    expect(before.from.toISOString()).toBe('2026-11-02T03:00:00.000Z');
    expect(before.to.toISOString()).toBe('2026-11-09T03:00:00.000Z');
  });
  it('no meio da semana também ancora na segunda local', () => {
    const { last } = previousWeeks(at('2026-11-11T15:00:00Z'), TZ);
    expect(last.from.toISOString()).toBe('2026-11-02T03:00:00.000Z');
  });
});
