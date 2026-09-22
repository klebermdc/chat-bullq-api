import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { dayKey, groupPresence, presenceStatus } from './presence.util';

const SAMPLE_INTERVAL_MS = 60_000;
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/**
 * A cada minuto, soma 1 minuto online (e 1 ativo, se mexeu no Chat) para cada
 * atendente conectado. Roda no processo da API porque lê as conexões desse
 * processo; com uma instância só da API, cada minuto conta uma vez.
 */
@Injectable()
export class PresenceSamplerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceSamplerService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sample().catch((err: unknown) =>
        this.logger.warn(`amostra de presença falhou: ${err instanceof Error ? err.message : err}`),
      );
    }, SAMPLE_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sample(now: Date = new Date()): Promise<void> {
    const users = groupPresence(await this.realtime.listSocketPresence());
    if (users.length === 0) return;

    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: [...new Set(users.map((u) => u.organizationId))] } },
      select: { id: true, aiTimezone: true },
    });
    const tzByOrg = new Map(orgs.map((o) => [o.id, o.aiTimezone || DEFAULT_TIMEZONE]));

    for (const user of users) {
      const day = new Date(`${dayKey(now, tzByOrg.get(user.organizationId) ?? DEFAULT_TIMEZONE)}T00:00:00Z`);
      const activeMinute = presenceStatus(user.lastActiveAt, now) === 'online' ? 1 : 0;
      const key = { organizationId: user.organizationId, userId: user.userId, day };
      try {
        await this.prisma.agentPresenceDaily.upsert({
          where: { organizationId_userId_day: key },
          create: {
            ...key,
            onlineMinutes: 1,
            activeMinutes: activeMinute,
            firstSeenAt: now,
            lastSeenAt: now,
          },
          update: {
            onlineMinutes: { increment: 1 },
            activeMinutes: { increment: activeMinute },
            lastSeenAt: now,
          },
        });
      } catch (err: unknown) {
        this.logger.warn(
          `presença de ${user.userId} não gravada: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }
}
