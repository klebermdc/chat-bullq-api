/**
 * Trava dos avisos no Redis (SET NX PX), sem tabela nova. Quem ganha a
 * chave manda; as outras réplicas/tiques ficam quietas até a chave expirar.
 */

/** Subconjunto do ioredis que a trava usa (o cliente do BullMQ serve). */
export interface ThrottleStore {
  set(key: string, value: string, px: 'PX', ttlMs: number, nx: 'NX'): Promise<string | null>;
}

const KEY_PREFIX = 'sla-gestao';
const MINUTE_MS = 60_000;
/** Chave do placar dura mais que um dia: cobre o dia local inteiro com folga. */
const SCOREBOARD_KEY_TTL_MS = 36 * 60 * MINUTE_MS;

export class ManagerAlertsThrottle {
  constructor(private readonly store: () => Promise<ThrottleStore>) {}

  /** true = pode mandar o resumo agora (e a janela de `intervalMinutes` começa). */
  claimDigest(organizationId: string, intervalMinutes: number): Promise<boolean> {
    return this.claim(`${KEY_PREFIX}:resumo:${organizationId}`, intervalMinutes * MINUTE_MS);
  }

  /** true = o placar deste dia local ainda não saiu. */
  claimScoreboard(organizationId: string, dateKey: string): Promise<boolean> {
    return this.claim(`${KEY_PREFIX}:placar:${organizationId}:${dateKey}`, SCOREBOARD_KEY_TTL_MS);
  }

  private async claim(key: string, ttlMs: number): Promise<boolean> {
    const store = await this.store();
    return (await store.set(key, '1', 'PX', ttlMs, 'NX')) === 'OK';
  }
}
