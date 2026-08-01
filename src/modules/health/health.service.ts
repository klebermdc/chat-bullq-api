import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../../database/prisma.service';
import { HEALTH_REDIS_CLIENT } from './health.redis.provider';

export interface HealthResult {
  status: 'ok' | 'degraded';
  checks: { db: 'ok' | 'fail'; redis: 'ok' | 'fail' };
}

/** Cada check tem que responder rápido, senão pendura o monitor externo. */
const CHECK_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(HEALTH_REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(): Promise<HealthResult> {
    const [db, redis] = await Promise.all([
      ok(() => withTimeout(this.prisma.$queryRaw`SELECT 1`)),
      ok(() => withTimeout(this.redis.ping())),
    ]);
    return {
      status: db === 'ok' && redis === 'ok' ? 'ok' : 'degraded',
      checks: { db, redis },
    };
  }
}

function withTimeout<T>(promise: PromiseLike<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const limite = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('health check timeout')),
      CHECK_TIMEOUT_MS,
    );
  });
  // clearTimeout no finally: sem isso cada health check deixaria um timer
  // pendurado por 2s, e o processo do Jest reclamaria de handle aberto.
  return Promise.race([Promise.resolve(promise), limite]).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * Recebe uma FUNÇÃO, não uma Promise, de propósito: assim um throw síncrono
 * do cliente (Prisma ou ioredis) também cai aqui dentro. Se escapasse, o
 * controller lançaria, o GlobalExceptionFilter reportaria um 5xx, e o painel
 * ganharia um issue novo a cada batida do monitor — justamente durante o
 * incidente que este endpoint existe para detectar.
 */
async function ok(executa: () => PromiseLike<unknown>): Promise<'ok' | 'fail'> {
  try {
    await executa();
    return 'ok';
  } catch {
    return 'fail';
  }
}
