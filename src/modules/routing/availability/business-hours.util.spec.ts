import {
  isWithinHours,
  nextOpenAt,
  previousCloseAt,
  formatReturn,
  formatHoursSummary,
  type BusinessHoursConfig,
} from './business-hours.util';

const TZ = 'America/Sao_Paulo'; // UTC-3, sem horário de verão

// Seg-Sex 09:00-18:00, fim de semana fechado
const NINE_TO_SIX: BusinessHoursConfig = {
  sunday: { enabled: false },
  monday: { enabled: true, windows: [['09:00', '18:00']] },
  tuesday: { enabled: true, windows: [['09:00', '18:00']] },
  wednesday: { enabled: true, windows: [['09:00', '18:00']] },
  thursday: { enabled: true, windows: [['09:00', '18:00']] },
  friday: { enabled: true, windows: [['09:00', '18:00']] },
  saturday: { enabled: false },
};

// Helper: constrói um Date UTC a partir de hora local em São Paulo (UTC-3).
const spDate = (isoLocal: string) => new Date(`${isoLocal}-03:00`);

describe('isWithinHours', () => {
  it('true dentro da janela (quarta 10:00)', () => {
    expect(isWithinHours(NINE_TO_SIX, TZ, spDate('2026-07-22T10:00:00'))).toBe(true);
  });
  it('false fora da janela (quarta 20:00)', () => {
    expect(isWithinHours(NINE_TO_SIX, TZ, spDate('2026-07-22T20:00:00'))).toBe(false);
  });
  it('false em dia desabilitado (sábado 12:00)', () => {
    expect(isWithinHours(NINE_TO_SIX, TZ, spDate('2026-07-25T12:00:00'))).toBe(false);
  });
  it('config null = 24/7', () => {
    expect(isWithinHours(null, TZ, spDate('2026-07-25T03:00:00'))).toBe(true);
  });
});

describe('nextOpenAt', () => {
  it('mesma noite -> abre 09:00 do dia seguinte (quarta 20:00 -> quinta 09:00)', () => {
    const d = nextOpenAt(NINE_TO_SIX, TZ, spDate('2026-07-22T20:00:00'));
    expect(d?.toISOString()).toBe(spDate('2026-07-23T09:00:00').toISOString());
  });
  it('antes de abrir -> abre no mesmo dia (quinta 07:00 -> quinta 09:00)', () => {
    const d = nextOpenAt(NINE_TO_SIX, TZ, spDate('2026-07-23T07:00:00'));
    expect(d?.toISOString()).toBe(spDate('2026-07-23T09:00:00').toISOString());
  });
  it('sexta a noite pula o fim de semana (sexta 19:00 -> segunda 09:00)', () => {
    const d = nextOpenAt(NINE_TO_SIX, TZ, spDate('2026-07-24T19:00:00'));
    expect(d?.toISOString()).toBe(spDate('2026-07-27T09:00:00').toISOString());
  });
  it('nenhum dia habilitado -> null', () => {
    const none: BusinessHoursConfig = { monday: { enabled: false } };
    expect(nextOpenAt(none, TZ, spDate('2026-07-22T20:00:00'))).toBeNull();
  });
});

describe('previousCloseAt', () => {
  it('sábado -> fechou sexta 18:00', () => {
    const d = previousCloseAt(NINE_TO_SIX, TZ, spDate('2026-07-25T12:00:00'));
    expect(d?.toISOString()).toBe(spDate('2026-07-24T18:00:00').toISOString());
  });
  it('quarta 20:00 -> fechou quarta 18:00', () => {
    const d = previousCloseAt(NINE_TO_SIX, TZ, spDate('2026-07-22T20:00:00'));
    expect(d?.toISOString()).toBe(spDate('2026-07-22T18:00:00').toISOString());
  });
});

describe('formatReturn', () => {
  it('hoje', () => {
    const now = spDate('2026-07-23T07:00:00');
    const at = spDate('2026-07-23T09:00:00');
    expect(formatReturn(at, TZ, now)).toBe('hoje às 09h');
  });
  it('amanhã', () => {
    const now = spDate('2026-07-22T20:00:00');
    const at = spDate('2026-07-23T09:00:00');
    expect(formatReturn(at, TZ, now)).toBe('amanhã às 09h');
  });
  it('dia da semana quando > 1 dia', () => {
    const now = spDate('2026-07-24T19:00:00');
    const at = spDate('2026-07-27T09:00:00');
    expect(formatReturn(at, TZ, now)).toMatch(/segunda-feira às 09h/);
  });
  it('inclui minutos quando != 00', () => {
    const now = spDate('2026-07-23T07:00:00');
    const at = spDate('2026-07-23T09:30:00');
    expect(formatReturn(at, TZ, now)).toBe('hoje às 09h30');
  });
});

describe('formatHoursSummary', () => {
  it('null quando config é null (24/7)', () => {
    expect(formatHoursSummary(null)).toBeNull();
  });
  it('null quando nenhum dia habilitado', () => {
    expect(formatHoursSummary({ monday: { enabled: false } })).toBeNull();
  });
  it('resume dias habilitados, hora cheia sem minutos', () => {
    const cfg = {
      monday: { enabled: true, windows: [['09:00', '18:00']] as Array<[string, string]> },
      saturday: { enabled: true, windows: [['09:00', '13:30']] as Array<[string, string]> },
      sunday: { enabled: false },
    };
    expect(formatHoursSummary(cfg)).toBe('seg: 09h às 18h; sáb: 09h às 13h30');
  });
  it('dia habilitado sem janelas = o dia todo', () => {
    expect(formatHoursSummary({ tuesday: { enabled: true } })).toBe('ter: o dia todo');
  });
});
