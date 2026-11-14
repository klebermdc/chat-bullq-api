import { BadRequestException } from '@nestjs/common';
import { resolveKpiMonth } from './kpi-month';

const TZ = 'America/Sao_Paulo';

describe('resolveKpiMonth', () => {
  test('mês informado: início e fim no fuso da org, mais o mês anterior', () => {
    const range = resolveKpiMonth('2026-11', new Date('2026-11-13T12:00:00Z'), TZ);

    expect(range).toEqual({
      month: '2026-11',
      start: new Date('2026-11-01T03:00:00Z'),
      end: new Date('2026-12-01T03:00:00Z'),
      previousStart: new Date('2026-10-01T03:00:00Z'),
    });
  });

  test('janeiro: o mês anterior é dezembro do ano anterior', () => {
    const range = resolveKpiMonth('2027-01', new Date('2026-11-13T12:00:00Z'), TZ);

    expect(range.previousStart).toEqual(new Date('2026-12-01T03:00:00Z'));
    expect(range.end).toEqual(new Date('2027-02-01T03:00:00Z'));
  });

  test('sem mês: usa o mês atual no fuso (dia 1º 01:00 UTC ainda é o mês anterior em São Paulo)', () => {
    expect(resolveKpiMonth(undefined, new Date('2026-12-01T01:00:00Z'), TZ).month).toBe('2026-11');
    expect(resolveKpiMonth('', new Date('2026-12-01T04:00:00Z'), TZ).month).toBe('2026-12');
  });

  test.each(['2026-13', '2026-00', '2026-1', '26-11', '2026/11', 'abc', '2026-11-01'])('formato inválido %s → 400', (month) => {
    expect(() => resolveKpiMonth(month, new Date(), TZ)).toThrow(BadRequestException);
  });

  test('mês repetido na query (array) → 400', () => {
    expect(() => resolveKpiMonth(['2026-11', '2026-10'] as unknown as string, new Date(), TZ)).toThrow(BadRequestException);
  });
});
