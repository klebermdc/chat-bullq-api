import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Rate limiter em memória, janela deslizante, só por IP.
 *
 * Espelha `channel-hub/webhook-throttle.guard.ts`, mas enxuto: aquele guard
 * compõe a chave com `req.params.channelType`, um parâmetro de rota que não
 * existe aqui — o webhook do Resend é uma única rota (`POST /webhooks/resend`)
 * para uma conta global, então IP sozinho já é a chave certa. Reusar o guard
 * do channel-hub direto faria toda essa rota cair no bucket `unknown`,
 * misturando contagem com qualquer outro chamador que também caia lá.
 *
 * Sem isso, uma assinatura errada (`RESEND_WEBHOOK_SECRET` desatualizado)
 * deixava a rota aberta a `curl -X POST` em loop sem autenticação e sem
 * limite — cada tentativa rejeitada ainda disparava `alertOwners()`.
 */
@Injectable()
export class ResendWebhookThrottleGuard implements CanActivate {
  private readonly logger = new Logger(ResendWebhookThrottleGuard.name);

  private static readonly WINDOW_MS = 10_000; // 10s
  private static readonly MAX_HITS = 60; // Resend não manda rajada; folgado de propósito.

  private readonly hits = new Map<string, number[]>();
  private lastGc = 0;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = this.extractIp(req);

    const now = Date.now();
    const windowStart = now - ResendWebhookThrottleGuard.WINDOW_MS;
    const entries = this.hits.get(ip) || [];
    const recent = entries.filter((t) => t >= windowStart);
    recent.push(now);
    this.hits.set(ip, recent);

    // GC leve pra manter o mapa limitado (roda no máximo uma vez a cada 30s).
    if (now - this.lastGc > 30_000) {
      this.lastGc = now;
      for (const [k, arr] of this.hits.entries()) {
        const trimmed = arr.filter((t) => t >= windowStart);
        if (trimmed.length === 0) this.hits.delete(k);
        else this.hits.set(k, trimmed);
      }
    }

    if (recent.length > ResendWebhookThrottleGuard.MAX_HITS) {
      this.logger.warn(`Throttled webhook do Resend vindo de ${ip} (${recent.length} hits/10s)`);
      return false;
    }
    return true;
  }

  private extractIp(req: Request): string {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
    if (Array.isArray(fwd) && fwd.length > 0) return fwd[0].split(',')[0].trim();
    return req.ip || 'unknown';
  }
}
