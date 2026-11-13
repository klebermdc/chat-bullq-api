import { BadRequestException } from '@nestjs/common';
import { resolvePeriod } from './costs.period';

const TZ = 'America/Sao_Paulo';
// 13/11/2026 15:00 BRT
const NOW = new Date('2026-11-13T18:00:00Z');

describe('resolvePeriod', () => {
  it('sem datas: do dia 1º do mês até agora', () => {
    const p = resolvePeriod(TZ, NOW);
    expect(p.from).toBe('2026-11-01');
    expect(p.to).toBe('2026-11-13');
    expect(p.start.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(p.end).toEqual(NOW);
  });

  it('dia fechado vai até a meia-noite local seguinte', () => {
    const p = resolvePeriod(TZ, NOW, '2026-11-12', '2026-11-12');
    expect(p.end.toISOString()).toBe('2026-11-13T03:00:00.000Z');
  });

  it('recusa datas ruins, invertidas, futuras e período longo', () => {
    expect(() => resolvePeriod(TZ, NOW, '2026-13-01', '2026-11-12')).toThrow(BadRequestException);
    expect(() => resolvePeriod(TZ, NOW, '2026-11-12', '2026-11-01')).toThrow(BadRequestException);
    expect(() => resolvePeriod(TZ, NOW, '2026-11-20', '2026-11-21')).toThrow(BadRequestException);
    expect(() => resolvePeriod(TZ, NOW, '2026-01-01', '2026-11-12')).toThrow(BadRequestException);
  });
});
