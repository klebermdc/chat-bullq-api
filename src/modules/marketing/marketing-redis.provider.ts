import { FactoryProvider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Cliente Redis dedicado ao módulo `marketing`.
 *
 * Mesmo padrão de `short-term/redis.provider.ts`: cliente próprio atrás de um
 * token, injetado em quem precisa (hoje só `OAuthHandshakeStore`) em vez de
 * cada serviço construir o seu. Isso permite substituir o cliente por um fake
 * em teste sem nunca abrir um socket real.
 */
export const MARKETING_REDIS_CLIENT = 'MARKETING_REDIS_CLIENT';

export const marketingRedisProvider: FactoryProvider<Redis> = {
  provide: MARKETING_REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const logger = new Logger('MarketingRedisProvider');
    const client = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      // Required for BullMQ / long-running blocking commands compatibility.
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });

    client.on('error', (err) => {
      logger.error(`Redis error: ${err.message}`);
    });

    return client;
  },
};
