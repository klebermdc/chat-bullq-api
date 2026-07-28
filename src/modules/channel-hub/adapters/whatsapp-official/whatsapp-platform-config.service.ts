import { Injectable } from '@nestjs/common';

/**
 * Credenciais do "app da plataforma" (o app Meta da OFP), compartilhadas por
 * todos os canais conectados via Embedded Signup. Lê do ambiente.
 */
@Injectable()
export class WhatsAppPlatformConfigService {
  get appId(): string { return process.env.WA_APP_ID ?? ''; }
  get appSecret(): string { return process.env.WA_APP_SECRET ?? ''; }
  get embeddedSignupConfigId(): string { return process.env.WA_ES_CONFIG_ID ?? ''; }
  get verifyToken(): string | undefined { return process.env.WA_VERIFY_TOKEN || undefined; }
  get apiVersion(): string { return process.env.WA_API_VERSION || 'v21.0'; }
  get isConfigured(): boolean { return Boolean(this.appId && this.appSecret); }
}
