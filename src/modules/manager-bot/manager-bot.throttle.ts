import type { ThrottleStore } from '../response-sla/manager-alerts/manager-alerts.throttle';

const KEY_PREFIX = 'gerente-tg';

/**
 * Trava no Redis (SET NX PX): quem ganha a chave manda; réplicas e tiques
 * seguintes ficam quietos até a chave expirar.
 */
export class ManagerBotThrottle {
  constructor(private readonly store: () => Promise<ThrottleStore>) {}

  async claim(key: string, ttlMs: number): Promise<boolean> {
    const store = await this.store();
    return (await store.set(`${KEY_PREFIX}:${key}`, '1', 'PX', ttlMs, 'NX')) === 'OK';
  }
}
