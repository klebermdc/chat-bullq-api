import { Injectable } from '@nestjs/common';

/**
 * Credenciais do app da plataforma (o app Meta da OFP) para o Instagram.
 * O Instagram tem App ID/Secret PRÓPRIOS dentro do mesmo app Meta que hospeda
 * o WhatsApp — não são os `WA_*`. Ficam na página do produto Instagram, não em
 * Configurações → Básico.
 */
@Injectable()
export class InstagramPlatformConfigService {
  get appId(): string {
    return process.env.IG_APP_ID ?? '';
  }

  get appSecret(): string {
    return process.env.IG_APP_SECRET ?? '';
  }

  get redirectUri(): string {
    return process.env.IG_REDIRECT_URI ?? '';
  }

  get apiVersion(): string {
    return process.env.IG_API_VERSION || 'v24.0';
  }

  get stateSecret(): string {
    return process.env.IG_STATE_SECRET ?? '';
  }

  /** Hosts para os quais o callback pode redirecionar de volta. */
  get returnAllowlist(): string[] {
    return (process.env.IG_RETURN_ALLOWLIST ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
  }

  /** Quantos dias antes do vencimento o cron tenta renovar. */
  get refreshThresholdDays(): number {
    const raw = Number(process.env.IG_TOKEN_REFRESH_THRESHOLD_DAYS);
    return Number.isFinite(raw) && raw > 0 ? raw : 15;
  }

  get isConfigured(): boolean {
    return Boolean(
      this.appId && this.appSecret && this.redirectUri && this.stateSecret,
    );
  }
}
