import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Chamadas da Graph API para o WhatsApp Calling (versão própria, sem mexer no
 * envio de mensagens, que segue na versão do canal).
 * Doc: developers.facebook.com/docs/whatsapp/cloud-api/calling
 */
export interface CallingChannel {
  config: unknown; // channels.config: { accessToken, phoneNumberId }
}

export interface PermissionState {
  canCall: boolean;
  status: string; // no_permission | temporary | permanent
  canRequest: boolean;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const DEFAULT_VERSION = 'v23.0';

function channelCreds(channel: CallingChannel): { token: string; phoneNumberId: string } {
  const cfg = (channel.config ?? {}) as Record<string, unknown>;
  const token = typeof cfg.accessToken === 'string' ? cfg.accessToken : '';
  const phoneNumberId = typeof cfg.phoneNumberId === 'string' ? cfg.phoneNumberId : '';
  if (!token || !phoneNumberId) throw new Error('Canal sem accessToken/phoneNumberId');
  return { token, phoneNumberId };
}

/** Número do cliente só com dígitos (formato que a Meta usa em user_wa_id / to). */
export function waDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function parsePermission(json: any): PermissionState {
  const actions: any[] = Array.isArray(json?.actions) ? json.actions : [];
  const can = (name: string) => actions.some((a) => a?.action_name === name && a?.can_perform_action === true);
  return {
    status: String(json?.permission?.status ?? 'no_permission'),
    canCall: can('start_call'),
    canRequest: can('send_call_permission_request'),
  };
}

@Injectable()
export class CallingGraphClient {
  private readonly logger = new Logger(CallingGraphClient.name);
  private readonly version: string;
  private fetchImpl: FetchLike = fetch;

  constructor(config: ConfigService) {
    this.version = config.get<string>('WHATSAPP_CALLING_API_VERSION')?.trim() || DEFAULT_VERSION;
  }

  /** Para testes. */
  useFetch(fetchImpl: FetchLike): this {
    this.fetchImpl = fetchImpl;
    return this;
  }

  private async graph(token: string, path: string, init: { method: string; body?: unknown }) {
    const res = await this.fetchImpl(`https://graph.facebook.com/${this.version}${path}`, {
      method: init.method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const meta = (json as any)?.error;
      throw new Error(`Meta ${res.status}: ${meta?.error_user_msg ?? meta?.message ?? 'erro'}`);
    }
    return json;
  }

  async getPermission(channel: CallingChannel, customerPhone: string): Promise<PermissionState> {
    const { token, phoneNumberId } = channelCreds(channel);
    const json = await this.graph(token, `/${phoneNumberId}/call_permissions?user_wa_id=${waDigits(customerPhone)}`, { method: 'GET' });
    return parsePermission(json);
  }

  /** Mensagem interativa de permissão (exige janela de atendimento aberta). Devolve o id da mensagem. */
  async requestPermission(channel: CallingChannel, customerPhone: string, bodyText: string): Promise<string | null> {
    const { token, phoneNumberId } = channelCreds(channel);
    const json: any = await this.graph(token, `/${phoneNumberId}/messages`, {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: waDigits(customerPhone),
        type: 'interactive',
        interactive: { type: 'call_permission_request', action: { name: 'call_permission_request' }, body: { text: bodyText } },
      },
    });
    return json?.messages?.[0]?.id ?? null;
  }

  /**
   * Liga/desliga o calling com SIP no número (ATIVAÇÃO — só por ação explícita
   * de admin; nada chama isto automaticamente).
   */
  async setCalling(channel: CallingChannel, enable: boolean, sipHost: string): Promise<void> {
    const { token, phoneNumberId } = channelCreds(channel);
    const body = enable
      ? {
          calling: {
            status: 'ENABLED',
            call_icon_visibility: 'DEFAULT',
            callback_permission_status: 'ENABLED',
            srtp_key_exchange_protocol: 'SDES',
            sip: { status: 'ENABLED', servers: [{ hostname: sipHost, port: 5061 }] },
          },
        }
      : { calling: { status: 'DISABLED' } };
    await this.graph(token, `/${phoneNumberId}/settings`, { method: 'POST', body });
    this.logger.log(`Calling ${enable ? 'ligado' : 'desligado'} no número ${phoneNumberId}`);
  }
}
