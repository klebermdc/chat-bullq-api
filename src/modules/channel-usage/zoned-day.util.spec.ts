import {
  listZonedDayKeys,
  startOfZonedDay,
  toZonedDayKey,
} from './zoned-day.util';

describe('toZonedDayKey', () => {
  it('usa o dia de São Paulo, não o dia UTC', () => {
    // 02:30 UTC ainda é 23:30 do dia anterior em São Paulo (UTC-3).
    expect(toZonedDayKey(new Date('2026-10-02T02:30:00Z'))).toBe('2026-10-01');
    expect(toZonedDayKey(new Date('2026-10-02T03:00:00Z'))).toBe('2026-10-02');
  });

  it('vira o ano no fuso certo', () => {
    expect(toZonedDayKey(new Date('2027-01-01T01:00:00Z'))).toBe('2026-12-31');
  });
});

describe('startOfZonedDay', () => {
  it('devolve o instante UTC da meia-noite de São Paulo', () => {
    expect(startOfZonedDay('2026-10-05').toISOString()).toBe(
      '2026-10-05T03:00:00.000Z',
    );
  });

  it('rejeita chave de dia malformada', () => {
    expect(() => startOfZonedDay('05/10/2026')).toThrow();
  });
});

describe('listZonedDayKeys', () => {
  it('lista todos os dias do intervalo [from, to), inclusive os vazios', () => {
    const days = listZonedDayKeys(
      new Date('2026-09-29T03:00:00Z'),
      new Date('2026-10-02T03:00:00Z'),
    );
    expect(days).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
  });

  it('inclui o dia parcial do fim quando `to` cai no meio do dia', () => {
    const days = listZonedDayKeys(
      new Date('2026-10-01T03:00:00Z'),
      new Date('2026-10-02T15:00:00Z'),
    );
    expect(days).toEqual(['2026-10-01', '2026-10-02']);
  });

  it('atravessa a virada de mês e de ano', () => {
    const days = listZonedDayKeys(
      new Date('2026-12-31T03:00:00Z'),
      new Date('2027-01-02T03:00:00Z'),
    );
    expect(days).toEqual(['2026-12-31', '2027-01-01']);
  });

  it('devolve vazio quando o intervalo é vazio', () => {
    const at = new Date('2026-10-01T12:00:00Z');
    expect(listZonedDayKeys(at, at)).toEqual([]);
  });
});
