import { NotificationType } from '@prisma/client';
import { isWithinDnd, preferenceAllowsPush, PushPreference } from './push-policy';

// 23:30 em São Paulo (UTC-3) = 02:30 UTC do dia seguinte.
const NIGHT_SP = new Date('2026-11-08T02:30:00Z');
// 10:00 em São Paulo.
const MORNING_SP = new Date('2026-11-07T13:00:00Z');

describe('isWithinDnd', () => {
  it('janela que cruza a meia-noite, no fuso da empresa', () => {
    expect(isWithinDnd('22:00', '07:00', NIGHT_SP)).toBe(true);
    expect(isWithinDnd('22:00', '07:00', MORNING_SP)).toBe(false);
  });

  it('janela no mesmo dia', () => {
    expect(isWithinDnd('09:00', '12:00', MORNING_SP)).toBe(true);
    expect(isWithinDnd('12:00', '18:00', MORNING_SP)).toBe(false);
  });

  it('sem início/fim ou formato inválido → fora da janela', () => {
    expect(isWithinDnd(null, '07:00', NIGHT_SP)).toBe(false);
    expect(isWithinDnd('22h', '07:00', NIGHT_SP)).toBe(false);
  });

  it('respeita outro fuso', () => {
    // 02:30 UTC = 02:30 em Londres (inverno) → dentro de 01:00–03:00.
    expect(isWithinDnd('01:00', '03:00', NIGHT_SP, 'Europe/London')).toBe(true);
  });
});

describe('preferenceAllowsPush', () => {
  const pref = (over: Partial<PushPreference> = {}): PushPreference => ({
    type: NotificationType.NEW_MESSAGE, browserPush: true, dndStart: null, dndEnd: null, ...over,
  });

  it('preferência ausente = ligada', () => {
    expect(preferenceAllowsPush(undefined, MORNING_SP)).toBe(true);
  });

  it('browserPush desligado = sem push', () => {
    expect(preferenceAllowsPush(pref({ browserPush: false }), MORNING_SP)).toBe(false);
  });

  it('dentro do Não-Perturbe = sem push', () => {
    expect(preferenceAllowsPush(pref({ dndStart: '22:00', dndEnd: '07:00' }), NIGHT_SP)).toBe(false);
    expect(preferenceAllowsPush(pref({ dndStart: '22:00', dndEnd: '07:00' }), MORNING_SP)).toBe(true);
  });
});
