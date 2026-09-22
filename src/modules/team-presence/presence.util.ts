/** Mexeu no Chat nos últimos 5 minutos = ativo; Chat aberto e parado = ausente. */
export const ACTIVE_WINDOW_MS = 5 * 60_000;

export type PresenceStatus = 'online' | 'away' | 'offline';

export interface SocketPresence {
  organizationId: string | undefined;
  userId: string | undefined;
  lastActiveAt: Date;
}

export interface UserPresence {
  organizationId: string;
  userId: string;
  lastActiveAt: Date;
}

/** Uma entrada por atendente e org, com a atividade mais recente entre as abas. */
export function groupPresence(sockets: SocketPresence[]): UserPresence[] {
  const byKey = new Map<string, UserPresence>();
  for (const { organizationId, userId, lastActiveAt } of sockets) {
    if (!organizationId || !userId) continue;
    const key = `${organizationId}:${userId}`;
    const current = byKey.get(key);
    if (!current || lastActiveAt > current.lastActiveAt) {
      byKey.set(key, { organizationId, userId, lastActiveAt });
    }
  }
  return [...byKey.values()];
}

export function presenceStatus(lastActiveAt: Date | null, now: Date): PresenceStatus {
  if (!lastActiveAt) return 'offline';
  return now.getTime() - lastActiveAt.getTime() <= ACTIVE_WINDOW_MS ? 'online' : 'away';
}

/** Data (AAAA-MM-DD) de `date` no fuso `tz`. */
export function dayKey(date: Date, tz: string): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
