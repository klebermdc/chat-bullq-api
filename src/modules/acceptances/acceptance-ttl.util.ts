export const DEFAULT_TTL_DAYS = 30;
export const MIN_TTL_DAYS = 1;
export const MAX_TTL_DAYS = 90;
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Prazo (em dias) para renovar um link: o mesmo que ele teve na criação
 * (expiresAt − createdAt, arredondado), dentro de [1, 90]. Sem as datas,
 * o padrão de 30 dias.
 */
export function renewalTtlDays(acc: { createdAt?: Date | null; expiresAt?: Date | null }): number {
  if (!(acc.createdAt instanceof Date) || !(acc.expiresAt instanceof Date)) return DEFAULT_TTL_DAYS;
  const days = Math.round((acc.expiresAt.getTime() - acc.createdAt.getTime()) / DAY_MS);
  if (!Number.isFinite(days) || days < MIN_TTL_DAYS) return DEFAULT_TTL_DAYS;
  return Math.min(days, MAX_TTL_DAYS);
}
