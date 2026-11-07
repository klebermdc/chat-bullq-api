import {
  addBusinessMinutes,
  businessMinutesBetween,
} from './business-minutes.util';
import type { BusinessHoursConfig } from './business-hours.util';

const TZ = 'America/Sao_Paulo'; // UTC-3, sem horário de verão

// Horário local de São Paulo → Date (UTC = local + 3h).
const sp = (isoLocal: string) => new Date(`${isoLocal}-03:00`);

const WEEKDAYS_9_18: BusinessHoursConfig = {
  monday: { enabled: true, windows: [['09:00', '18:00']] },
  tuesday: { enabled: true, windows: [['09:00', '18:00']] },
  wednesday: { enabled: true, windows: [['09:00', '18:00']] },
  thursday: { enabled: true, windows: [['09:00', '18:00']] },
  friday: { enabled: true, windows: [['09:00', '18:00']] },
  saturday: { enabled: false },
  sunday: { enabled: false },
};

// Agenda tipo Marcella: tarde/noite na semana e domingo de manhã/tarde.
const MARCELLA: BusinessHoursConfig = {
  monday: { enabled: true, windows: [['14:00', '22:00']] },
  tuesday: { enabled: true, windows: [['14:00', '22:00']] },
  wednesday: { enabled: true, windows: [['14:00', '22:00']] },
  thursday: { enabled: true, windows: [['14:00', '22:00']] },
  friday: { enabled: true, windows: [['14:00', '22:00']] },
  saturday: { enabled: false },
  sunday: { enabled: true, windows: [['09:00', '18:00']] },
};

const SPLIT_DAY: BusinessHoursConfig = {
  monday: { enabled: true, windows: [['09:00', '12:00'], ['14:00', '18:00']] },
};

// 2026-11-09 é segunda-feira; 2026-11-13 sexta; 2026-11-15 domingo.
describe('addBusinessMinutes', () => {
  it('soma direto quando começa dentro da janela', () => {
    const due = addBusinessMinutes(WEEKDAYS_9_18, TZ, sp('2026-11-09T10:00:00'), 15);
    expect(due).toEqual(sp('2026-11-09T10:15:00'));
  });

  it('começa a contar na abertura quando chega antes do expediente', () => {
    const due = addBusinessMinutes(WEEKDAYS_9_18, TZ, sp('2026-11-09T07:30:00'), 15);
    expect(due).toEqual(sp('2026-11-09T09:15:00'));
  });

  it('mensagem às 23h conta a partir das 09h do dia seguinte', () => {
    const due = addBusinessMinutes(WEEKDAYS_9_18, TZ, sp('2026-11-09T23:00:00'), 15);
    expect(due).toEqual(sp('2026-11-10T09:15:00'));
  });

  it('pausa no fechamento e continua no próximo expediente', () => {
    const due = addBusinessMinutes(WEEKDAYS_9_18, TZ, sp('2026-11-09T17:50:00'), 15);
    expect(due).toEqual(sp('2026-11-10T09:05:00'));
  });

  it('atravessa o fim de semana (sexta 17:55 → segunda 09:10)', () => {
    const due = addBusinessMinutes(WEEKDAYS_9_18, TZ, sp('2026-11-13T17:55:00'), 15);
    expect(due).toEqual(sp('2026-11-16T09:10:00'));
  });

  it('prazo que cai exatamente no fechamento vai para a próxima abertura', () => {
    const due = addBusinessMinutes(WEEKDAYS_9_18, TZ, sp('2026-11-09T17:45:00'), 15);
    expect(due).toEqual(sp('2026-11-10T09:00:00'));
  });

  it('respeita várias janelas no mesmo dia (pula o almoço)', () => {
    const due = addBusinessMinutes(SPLIT_DAY, TZ, sp('2026-11-09T11:50:00'), 15);
    expect(due).toEqual(sp('2026-11-09T14:05:00'));
  });

  it('agenda Marcella: segunda 10h conta a partir das 14h', () => {
    const due = addBusinessMinutes(MARCELLA, TZ, sp('2026-11-09T10:00:00'), 15);
    expect(due).toEqual(sp('2026-11-09T14:15:00'));
  });

  it('agenda Marcella: sexta 21:50 pula sábado e retoma domingo 09h', () => {
    const due = addBusinessMinutes(MARCELLA, TZ, sp('2026-11-13T21:50:00'), 15);
    expect(due).toEqual(sp('2026-11-15T09:05:00'));
  });

  it('agenda Marcella: domingo 17:55 retoma segunda 14h', () => {
    const due = addBusinessMinutes(MARCELLA, TZ, sp('2026-11-15T17:55:00'), 15);
    expect(due).toEqual(sp('2026-11-16T14:10:00'));
  });

  it('dia habilitado sem janelas conta o dia inteiro', () => {
    const allDay: BusinessHoursConfig = { monday: { enabled: true } };
    const due = addBusinessMinutes(allDay, TZ, sp('2026-11-09T23:55:00'), 15);
    // segunda acaba 24:00; terça desabilitada → segunda seguinte 00:00 + 10
    expect(due).toEqual(sp('2026-11-16T00:10:00'));
  });

  it('config null = 24/7 (soma relógio)', () => {
    const start = sp('2026-11-14T03:00:00');
    expect(addBusinessMinutes(null, TZ, start, 15)).toEqual(sp('2026-11-14T03:15:00'));
  });

  it('nenhum dia habilitado devolve null', () => {
    const closed: BusinessHoursConfig = { monday: { enabled: false } };
    expect(addBusinessMinutes(closed, TZ, sp('2026-11-09T10:00:00'), 15)).toBeNull();
  });

  it('meio prazo fracionado (7,5 min)', () => {
    const due = addBusinessMinutes(WEEKDAYS_9_18, TZ, sp('2026-11-09T10:00:00'), 7.5);
    expect(due).toEqual(sp('2026-11-09T10:07:30'));
  });

  it('preserva segundos do início', () => {
    const due = addBusinessMinutes(WEEKDAYS_9_18, TZ, sp('2026-11-09T10:00:42'), 15);
    expect(due).toEqual(sp('2026-11-09T10:15:42'));
  });

  it('ignora janela inválida (fim antes do início)', () => {
    const bad: BusinessHoursConfig = {
      monday: { enabled: true, windows: [['22:00', '02:00'], ['09:00', '10:00']] },
    };
    const due = addBusinessMinutes(bad, TZ, sp('2026-11-09T09:00:00'), 15);
    expect(due).toEqual(sp('2026-11-09T09:15:00'));
  });
});

describe('businessMinutesBetween', () => {
  it('conta só o tempo dentro do expediente', () => {
    const min = businessMinutesBetween(
      WEEKDAYS_9_18, TZ, sp('2026-11-09T17:50:00'), sp('2026-11-10T09:05:00'),
    );
    expect(min).toBe(15);
  });

  it('mensagem às 23h respondida às 09:10 = 10 min', () => {
    const min = businessMinutesBetween(
      WEEKDAYS_9_18, TZ, sp('2026-11-09T23:00:00'), sp('2026-11-10T09:10:00'),
    );
    expect(min).toBe(10);
  });

  it('fim de semana inteiro vale zero', () => {
    const min = businessMinutesBetween(
      WEEKDAYS_9_18, TZ, sp('2026-11-14T08:00:00'), sp('2026-11-15T23:00:00'),
    );
    expect(min).toBe(0);
  });

  it('desconta o intervalo entre janelas', () => {
    const min = businessMinutesBetween(
      SPLIT_DAY, TZ, sp('2026-11-09T11:00:00'), sp('2026-11-09T15:00:00'),
    );
    expect(min).toBe(120);
  });

  it('agenda Marcella: sexta 21h → domingo 10h = 120 min', () => {
    const min = businessMinutesBetween(
      MARCELLA, TZ, sp('2026-11-13T21:00:00'), sp('2026-11-15T10:00:00'),
    );
    expect(min).toBe(120);
  });

  it('vários dias úteis somam 9h por dia', () => {
    const min = businessMinutesBetween(
      WEEKDAYS_9_18, TZ, sp('2026-11-09T00:00:00'), sp('2026-11-11T00:00:00'),
    );
    expect(min).toBe(2 * 9 * 60);
  });

  it('config null = 24/7', () => {
    const min = businessMinutesBetween(
      null, TZ, sp('2026-11-14T03:00:00'), sp('2026-11-14T04:30:00'),
    );
    expect(min).toBe(90);
  });

  it('intervalo invertido ou vazio vale zero', () => {
    const t = sp('2026-11-09T10:00:00');
    expect(businessMinutesBetween(WEEKDAYS_9_18, TZ, t, t)).toBe(0);
    expect(businessMinutesBetween(WEEKDAYS_9_18, TZ, t, sp('2026-11-09T09:00:00'))).toBe(0);
  });

  it('é o inverso de addBusinessMinutes', () => {
    const start = sp('2026-11-13T17:55:00');
    const due = addBusinessMinutes(WEEKDAYS_9_18, TZ, start, 15)!;
    expect(businessMinutesBetween(WEEKDAYS_9_18, TZ, start, due)).toBe(15);
  });
});
