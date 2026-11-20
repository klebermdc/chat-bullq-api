import {
  formatHolidayReturn,
  holidayEndFromDate,
  holidayReturnAt,
  isHolidayActive,
  MAX_HOLIDAY_DAYS,
} from './holiday.util';

const TZ = 'America/Sao_Paulo';
// Seg-sex 9h-18h.
const HOURS = {
  monday: { enabled: true, windows: [['09:00', '18:00']] as Array<[string, string]> },
  tuesday: { enabled: true, windows: [['09:00', '18:00']] as Array<[string, string]> },
  wednesday: { enabled: true, windows: [['09:00', '18:00']] as Array<[string, string]> },
  thursday: { enabled: true, windows: [['09:00', '18:00']] as Array<[string, string]> },
  friday: { enabled: true, windows: [['09:00', '18:00']] as Array<[string, string]> },
  saturday: { enabled: false },
  sunday: { enabled: false },
};

// Sexta 20/11/2026 10:00 em São Paulo.
const FRIDAY_10H = new Date('2026-11-20T13:00:00Z');

describe('isHolidayActive', () => {
  it('fica ativo antes do fim e desliga sozinho depois', () => {
    const until = new Date('2026-11-21T03:00:00Z');

    expect(isHolidayActive(until, FRIDAY_10H)).toBe(true);
    expect(isHolidayActive(until, new Date('2026-11-21T03:00:01Z'))).toBe(false);
  });

  it('sem data é desligado', () => {
    expect(isHolidayActive(null, FRIDAY_10H)).toBe(false);
    expect(isHolidayActive(undefined, FRIDAY_10H)).toBe(false);
  });
});

describe('holidayEndFromDate', () => {
  it('termina à meia-noite do fim do dia escolhido no fuso da agência', () => {
    const end = holidayEndFromDate('2026-11-20', TZ, FRIDAY_10H);

    // 21/11 00:00 em São Paulo = 03:00 UTC.
    expect(end.toISOString()).toBe('2026-11-21T03:00:00.000Z');
  });

  it('recusa dia que já passou', () => {
    expect(() => holidayEndFromDate('2026-11-19', TZ, FRIDAY_10H)).toThrow('passou');
  });

  it(`recusa mais de ${MAX_HOLIDAY_DAYS} dias à frente`, () => {
    expect(() => holidayEndFromDate('2026-12-31', TZ, FRIDAY_10H)).toThrow('dias');
  });

  it('recusa formato inválido', () => {
    expect(() => holidayEndFromDate('20/11/2026', TZ, FRIDAY_10H)).toThrow();
    expect(() => holidayEndFromDate('2026-02-31', TZ, FRIDAY_10H)).toThrow();
  });
});

describe('holidayReturnAt', () => {
  it('volta na primeira abertura depois do feriado', () => {
    // Feriado até o fim de sexta → próxima abertura é segunda 9h.
    const until = new Date('2026-11-21T03:00:00Z');

    const back = holidayReturnAt(HOURS, TZ, until);

    expect(back.toISOString()).toBe('2026-11-23T12:00:00.000Z');
  });

  it('agência 24/7 volta assim que o feriado acaba', () => {
    const until = new Date('2026-11-21T03:00:00Z');

    expect(holidayReturnAt(null, TZ, until)).toEqual(until);
  });
});

describe('formatHolidayReturn', () => {
  it('usa dia da semana quando é nesta semana', () => {
    const back = new Date('2026-11-23T12:00:00Z');

    expect(formatHolidayReturn(back, TZ, FRIDAY_10H)).toBe('segunda-feira às 09h');
  });

  it('usa a data quando passa de uma semana', () => {
    const back = new Date('2026-12-01T12:00:00Z');

    expect(formatHolidayReturn(back, TZ, FRIDAY_10H)).toBe('dia 01/12 às 09h');
  });
});
