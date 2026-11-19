import type { ThrottleStore } from '../response-sla/manager-alerts/manager-alerts.throttle';

const KEY_PREFIX = 'pulso-equipe';
/** Cobre a hora inteira com folga; retry ou restart na mesma hora não reenviam. */
const HOUR_KEY_TTL_MS = 2 * 60 * 60_000;

/** Trava no Redis (SET NX PX) por org + dia local + hora: quem ganha a chave manda. */
export class TeamPulseThrottle {
  constructor(private readonly store: () => Promise<ThrottleStore>) {}

  async claimHour(organizationId: string, dateKey: string, hour: number): Promise<boolean> {
    const store = await this.store();
    const key = `${KEY_PREFIX}:${organizationId}:${dateKey}:${hour}`;
    return (await store.set(key, '1', 'PX', HOUR_KEY_TTL_MS, 'NX')) === 'OK';
  }
}
