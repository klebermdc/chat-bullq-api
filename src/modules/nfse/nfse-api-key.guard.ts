import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';

export const NFSE_API_KEY_ENV = 'HUB_NFSE_API_KEY';
const HEADER = 'x-api-key';

/** Compara em tempo constante (hash dos dois lados: mesmo tamanho sempre). */
export function sameApiKey(received: string, expected: string): boolean {
  const left = createHash('sha256').update(received).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

/** Só o OFP Hub chama o envio da NFS-e: cabeçalho x-api-key = HUB_NFSE_API_KEY. */
@Injectable()
export class NfseApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(NfseApiKeyGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>(NFSE_API_KEY_ENV)?.trim();
    if (!expected) {
      this.logger.warn(`${NFSE_API_KEY_ENV} não configurada: envio de NFS-e recusado`);
      throw new UnauthorizedException();
    }
    const header = context.switchToHttp().getRequest().headers?.[HEADER];
    const received = typeof header === 'string' ? header.trim() : '';
    if (!received || !sameApiKey(received, expected)) throw new UnauthorizedException();
    return true;
  }
}
