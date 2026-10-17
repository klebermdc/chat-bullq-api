import { BadRequestException } from '@nestjs/common';
import { resolveUsageRange } from './usage-range.util';

const NOW = new Date('2026-10-05T15:00:00Z'); // 12:00 em São Paulo

describe('resolveUsageRange', () => {
  it('default: últimos 30 dias de São Paulo, terminando agora', () => {
    const { from, to } = resolveUsageRange({}, NOW);
    expect(to).toEqual(NOW);
    // 30 dias contando hoje: 06/09 00:00 de São Paulo.
    expect(from.toISOString()).toBe('2026-09-06T03:00:00.000Z');
  });

  it('respeita from/to informados', () => {
    const { from, to } = resolveUsageRange(
      { from: '2026-10-01T03:00:00Z', to: '2026-10-03T03:00:00Z' },
      NOW,
    );
    expect(from.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-03T03:00:00.000Z');
  });

  it('só `to` informado: 30 dias para trás a partir dele', () => {
    const { from, to } = resolveUsageRange({ to: '2026-09-10T03:00:00Z' }, NOW);
    expect(to.toISOString()).toBe('2026-09-10T03:00:00.000Z');
    expect(from.toISOString()).toBe('2026-08-11T03:00:00.000Z');
  });

  it('rejeita from >= to', () => {
    expect(() =>
      resolveUsageRange(
        { from: '2026-10-03T00:00:00Z', to: '2026-10-03T00:00:00Z' },
        NOW,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      resolveUsageRange(
        { from: '2026-10-04T00:00:00Z', to: '2026-10-03T00:00:00Z' },
        NOW,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejeita intervalo maior que 366 dias', () => {
    expect(() =>
      resolveUsageRange(
        { from: '2025-10-01T00:00:00Z', to: '2026-10-05T00:00:00Z' },
        NOW,
      ),
    ).toThrow(BadRequestException);
  });

  it('aceita exatamente 366 dias', () => {
    expect(() =>
      resolveUsageRange(
        { from: '2025-10-04T00:00:00Z', to: '2026-10-05T00:00:00Z' },
        NOW,
      ),
    ).not.toThrow();
  });

  it('rejeita data inválida mesmo se passar do DTO', () => {
    expect(() => resolveUsageRange({ from: 'ontem' }, NOW)).toThrow(
      BadRequestException,
    );
  });
});
