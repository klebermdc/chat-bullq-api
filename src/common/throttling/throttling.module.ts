import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModule,
  ThrottlerModuleOptions,
} from '@nestjs/throttler';
import type { Request } from 'express';

import { shouldSkipThrottle } from './throttle-policy';

/**
 * Limite GERAL, por IP. Alto de propósito: ele existe para conter abuso
 * automatizado, não para atrapalhar operador. Um atendente rodando o inbox
 * inteiro com filtro, busca e realtime não chega perto disto.
 */
const LIMITE_GERAL = { ttl: 60_000, limit: 600 };

/**
 * Limite do `/auth`. Este é o que importa: fecha enumeração de credencial e
 * criação em massa de organização pelo `/auth/register`, que é público.
 *
 * 10/min por IP é folgado para gente e apertado para script. O login ainda
 * paga bcrypt de 12 rounds por tentativa, então sem limite o atacante gasta
 * mais CPU nossa que dele — era o pior dos dois mundos.
 */
export const LIMITE_AUTH = { ttl: 60_000, limit: 10 };

/**
 * Guard que respeita a `throttle-policy`.
 *
 * `getTracker` lê `req.ip`, que só é o IP real do cliente porque o `main.ts`
 * liga `trust proxy`. Sem isso, atrás do Caddy TODA requisição chega com o IP
 * do container do proxy — a internet inteira viraria um cliente só e o
 * primeiro visitante consumiria a cota de todo mundo.
 */
class PolicyAwareThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: {
    switchToHttp: () => { getRequest: () => Request };
  }): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    return shouldSkipThrottle(req.originalUrl || req.url || '');
  }

  protected async getTracker(req: Request): Promise<string> {
    return req.ip ?? 'desconhecido';
  }
}

const opcoes: ThrottlerModuleOptions = {
  throttlers: [{ name: 'geral', ...LIMITE_GERAL }],
};

@Module({
  imports: [ThrottlerModule.forRoot(opcoes)],
  providers: [{ provide: APP_GUARD, useClass: PolicyAwareThrottlerGuard }],
})
export class ThrottlingModule {}
