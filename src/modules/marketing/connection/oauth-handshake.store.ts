import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { MARKETING_REDIS_CLIENT } from '../marketing-redis.provider';
import { MetaAdAccount } from './meta-oauth.client';

/** Dez minutos: tempo de sobra para escolher a conta, curto para vazar. */
export const HANDSHAKE_TTL_SECONDS = 600;

export interface OAuthHandshake {
  /** Token de longa duração, já cifrado pelo CryptoService. */
  tokenEnc: string;
  /** ISO 8601, ou null quando a Meta não informa expiração. */
  expiresAt: string | null;
  accounts: MetaAdAccount[];
}

/**
 * Guarda o resultado da troca do `code` entre os dois passos da conexão.
 *
 * Existe porque código de autorização OAuth é de uso único: trocar o mesmo
 * `code` no passo 1 e de novo no passo 2 falha sempre. As alternativas eram
 * devolver o token ao navegador entre os passos — uma credencial de 60 dias no
 * cliente, inaceitável — ou guardá-lo no servidor. Esta é a segunda.
 *
 * Mesmo padrão de `IdempotencyService`: cliente ioredis próprio, TTL curto.
 */
@Injectable()
export class OAuthHandshakeStore implements OnModuleDestroy {
  private readonly logger = new Logger(OAuthHandshakeStore.name);

  constructor(@Inject(MARKETING_REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      /* noop */
    }
  }

  private key(handshakeId: string): string {
    return `marketing:oauth:${handshakeId}`;
  }

  async save(handshake: OAuthHandshake): Promise<string> {
    const handshakeId = randomUUID();
    await this.redis.set(
      this.key(handshakeId),
      JSON.stringify(handshake),
      'EX',
      HANDSHAKE_TTL_SECONDS,
    );
    return handshakeId;
  }

  /** Leitura destrutiva: um handshake serve uma vez só. */
  async consume(handshakeId: string): Promise<OAuthHandshake | null> {
    if (!handshakeId) return null;
    const raw = await this.redis.get(this.key(handshakeId));
    if (!raw) return null;
    await this.redis.del(this.key(handshakeId));
    try {
      return JSON.parse(raw) as OAuthHandshake;
    } catch {
      this.logger.warn(`handshake ${handshakeId} com payload invalido`);
      return null;
    }
  }
}
