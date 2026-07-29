import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { InstagramPlatformConfigService } from './instagram-platform-config.service';

export const IG_OAUTH_REDIS = 'IG_OAUTH_REDIS';

/** Quanto tempo o state vale. A Meta leva segundos; 10 min é folga de sobra. */
const STATE_TTL_SECONDS = 600;

export interface IgOAuthStateInput {
  organizationId: string;
  userOrganizationId: string;
  role: OrgRole;
  /** URL absoluta https para onde o callback redireciona de volta. */
  returnTo: string;
}

export interface IgOAuthStatePayload extends IgOAuthStateInput {
  nonce: string;
  /** epoch ms */
  exp: number;
}

/**
 * O `state` do OAuth carrega a identidade através do redirect da Meta, porque o
 * JWT não sobrevive a ele. Como o `/callback` roda SEM guard, tudo que vem aqui
 * dentro precisa ser inforjável: HMAC com segredo nosso, validade curta, e nonce
 * de uso único pra um state interceptado não servir duas vezes.
 */
@Injectable()
export class InstagramOAuthStateService {
  constructor(
    private readonly platform: InstagramPlatformConfigService,
    @Inject(IG_OAUTH_REDIS) private readonly redis: Redis,
  ) {}

  private hmac(body: string): string {
    return crypto
      .createHmac('sha256', this.platform.stateSecret)
      .update(body)
      .digest('hex');
  }

  sign(input: IgOAuthStateInput): string {
    const payload: IgOAuthStatePayload = {
      ...input,
      nonce: crypto.randomBytes(16).toString('hex'),
      exp: Date.now() + STATE_TTL_SECONDS * 1000,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.hmac(body)}`;
  }

  async verify(state: string): Promise<IgOAuthStatePayload> {
    const [body, signature] = (state ?? '').split('.');
    if (!body || !signature) {
      throw new BadRequestException('state malformado');
    }

    const expected = this.hmac(body);
    const ok =
      signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!ok) {
      throw new BadRequestException('state com assinatura invalida');
    }

    let payload: IgOAuthStatePayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('state ilegivel');
    }

    if (!payload.exp || payload.exp < Date.now()) {
      throw new BadRequestException('state expirado');
    }

    this.assertReturnToPermitido(payload.returnTo);

    // Uso único: SETNX devolve null se a chave já existe.
    const burned = await this.redis.set(
      `ig:oauth:nonce:${payload.nonce}`,
      '1',
      'EX',
      STATE_TTL_SECONDS,
      'NX',
    );
    if (burned !== 'OK') {
      throw new BadRequestException('state ja usado — vale uma vez so');
    }

    return payload;
  }

  /**
   * O `returnTo` só chega aqui dentro de um state que nós assinamos, então não é
   * input de terceiro. A allowlist protege do nosso próprio erro: um returnTo mal
   * preenchido no /authorize mandaria o usuário para fora do produto depois de
   * autorizar. Host na allowlist e https obrigatório.
   */
  private assertReturnToPermitido(returnTo: string): void {
    let url: URL;
    try {
      url = new URL(returnTo);
    } catch {
      throw new BadRequestException('destino de retorno invalido');
    }
    if (url.protocol !== 'https:') {
      throw new BadRequestException('destino de retorno precisa ser https');
    }
    if (!this.platform.returnAllowlist.includes(url.host)) {
      throw new BadRequestException(`returnTo nao permitido: ${url.host}`);
    }
  }
}
