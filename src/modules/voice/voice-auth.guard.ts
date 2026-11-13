import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { VOICE_SIGNATURE_HEADER, VOICE_TIMESTAMP_HEADER, verifyVoiceRequest } from './voice-signature.util';

/** Só o agente de voz (segredo VOICE_SERVICE_SECRET) chama /voice/tools. Sem segredo, nada passa. */
@Injectable()
export class VoiceAuthGuard implements CanActivate {
  private readonly logger = new Logger(VoiceAuthGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const ok = verifyVoiceRequest({
      secret: this.config.get<string>('VOICE_SERVICE_SECRET') ?? '',
      timestamp: req.header(VOICE_TIMESTAMP_HEADER) ?? undefined,
      signature: req.header(VOICE_SIGNATURE_HEADER) ?? undefined,
      body: req.rawBody ?? Buffer.from(''),
      now: new Date(),
    });
    if (!ok) {
      this.logger.warn(`Assinatura de voz inválida de ${req.ip}`);
      throw new UnauthorizedException();
    }
    return true;
  }
}
