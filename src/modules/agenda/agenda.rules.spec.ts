import type { BusinessHoursConfig } from '../routing/availability/business-hours.util';
import { checkNewAppointment, freeSlots, overlaps } from './agenda.rules';

const TZ = 'America/Sao_Paulo';
// Segunda a sexta 09–12 e 13–18 (almoço fechado). Sábado e domingo fechados.
const WEEKDAYS: BusinessHoursConfig = Object.fromEntries(
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((d) => [
    d,
    { enabled: true, windows: [['09:00', '12:00'], ['13:00', '18:00']] as [string, string][] },
  ]),
);
/** Horário de Brasília (UTC-3) → Date. */
const sp = (iso: string) => new Date(`${iso}-03:00`);

describe('overlaps', () => {
  it('detecta sobreposição e ignora encostar no fim', () => {
    const a = { startsAt: sp('2026-11-16T10:00:00'), durationMin: 30 };
    expect(overlaps(a, { startsAt: sp('2026-11-16T10:15:00'), durationMin: 15 })).toBe(true);
    expect(overlaps(a, { startsAt: sp('2026-11-16T10:30:00'), durationMin: 15 })).toBe(false);
    expect(overlaps(a, { startsAt: sp('2026-11-16T09:45:00'), durationMin: 15 })).toBe(false);
  });
});

describe('checkNewAppointment', () => {
  const now = sp('2026-11-13T15:00:00'); // sexta 15h
  const base = { hours: WEEKDAYS, tz: TZ, now, busy: [] as { startsAt: Date; durationMin: number }[], durationMin: 15 };

  it('aceita horário livre dentro do expediente', () => {
    expect(checkNewAppointment({ ...base, startsAt: sp('2026-11-16T10:00:00') })).toBeNull();
  });

  it('recusa horário no passado', () => {
    expect(checkNewAppointment({ ...base, startsAt: sp('2026-11-13T14:00:00') })).toBe('PASSADO');
  });

  it('recusa fora do expediente (fim de semana, almoço, e quando termina depois do fechamento)', () => {
    expect(checkNewAppointment({ ...base, startsAt: sp('2026-11-14T10:00:00') })).toBe('FORA_DO_EXPEDIENTE');
    expect(checkNewAppointment({ ...base, startsAt: sp('2026-11-16T12:30:00') })).toBe('FORA_DO_EXPEDIENTE');
    expect(checkNewAppointment({ ...base, startsAt: sp('2026-11-16T17:50:00') })).toBe('FORA_DO_EXPEDIENTE');
  });

  it('recusa conflito com compromisso do vendedor', () => {
    const busy = [{ startsAt: sp('2026-11-16T10:00:00'), durationMin: 15 }];
    expect(checkNewAppointment({ ...base, busy, startsAt: sp('2026-11-16T10:10:00') })).toBe('CONFLITO');
  });

  it('vendedor sem horário cadastrado: vale 24h (mesma regra do SLA)', () => {
    expect(checkNewAppointment({ ...base, hours: null, startsAt: sp('2026-11-14T22:00:00') })).toBeNull();
  });
});

describe('freeSlots', () => {
  const now = sp('2026-11-13T15:20:00'); // sexta 15h20

  it('devolve os próximos horários livres alinhados de 30 em 30, com antecedência mínima', () => {
    const slots = freeSlots({ hours: WEEKDAYS, tz: TZ, now, busy: [], durationMin: 15, count: 4, minLeadMin: 60 });
    expect(slots).toEqual([
      sp('2026-11-13T16:30:00'),
      sp('2026-11-13T17:00:00'),
      sp('2026-11-13T17:30:00'),
      sp('2026-11-16T09:00:00'),
    ]);
  });

  it('pula horários ocupados e o almoço', () => {
    const busy = [{ startsAt: sp('2026-11-16T09:00:00'), durationMin: 60 }];
    const slots = freeSlots({
      hours: WEEKDAYS,
      tz: TZ,
      now: sp('2026-11-16T08:00:00'),
      busy,
      durationMin: 30,
      count: 4,
      minLeadMin: 0,
    });
    expect(slots).toEqual([
      sp('2026-11-16T10:00:00'),
      sp('2026-11-16T10:30:00'),
      sp('2026-11-16T11:00:00'),
      sp('2026-11-16T11:30:00'),
    ]);
  });

  it('respeita o horizonte e devolve vazio quando nada abre', () => {
    const closed: BusinessHoursConfig = { monday: { enabled: false } };
    expect(freeSlots({ hours: closed, tz: TZ, now, busy: [], durationMin: 15, count: 3, minLeadMin: 0 })).toEqual([]);
  });
});
