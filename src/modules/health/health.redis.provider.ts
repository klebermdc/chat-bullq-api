import { FactoryProvider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Cliente Redis próprio do health check. Segue o padrão já usado no projeto
 * (`IdempotencyService`, `PresenceService`, short-term memory): cada serviço
 * instancia o seu. Quando existir um RedisModule compartilhado, este provider
 * some.
 */
export const HEALTH_REDIS_CLIENT = 'HEALTH_REDIS_CLIENT';

export const healthRedisProvider: FactoryProvider<Redis> = {
  provide: HEALTH_REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const logger = new Logger('HealthRedisProvider');
    const client = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });
    client.on('error', (err) => logger.error(`Redis error: ${err.message}`));
    return client;
  },
};
