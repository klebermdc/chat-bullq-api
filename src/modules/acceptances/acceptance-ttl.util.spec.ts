import { renewalTtlDays } from './acceptance-ttl.util';

const day = 86_400_000;
const at = (d: number) => new Date(Date.UTC(2026, 10, 1) + d);

describe('renewalTtlDays', () => {
  it('reusa a duração original arredondada em dias', () => {
    expect(renewalTtlDays({ createdAt: at(0), expiresAt: at(7 * day + 1000) })).toBe(7);
    expect(renewalTtlDays({ createdAt: at(0), expiresAt: at(30 * day) })).toBe(30);
  });

  it('sem datas ou duração inválida cai em 30', () => {
    expect(renewalTtlDays({})).toBe(30);
    expect(renewalTtlDays({ createdAt: at(0), expiresAt: null })).toBe(30);
    expect(renewalTtlDays({ createdAt: at(0), expiresAt: at(-day) })).toBe(30);
  });

  it('limita a 90 dias', () => {
    expect(renewalTtlDays({ createdAt: at(0), expiresAt: at(400 * day) })).toBe(90);
  });
});
