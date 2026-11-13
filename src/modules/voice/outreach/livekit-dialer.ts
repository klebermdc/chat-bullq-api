import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Disca pelo LiveKit (API Twirp) sem SDK: despacha a Aline na sala com a
 * missão e cria o participante SIP que liga para o cliente pelo tronco de
 * saída da Meta (wa.meta.vc). Sem LIVEKIT_* configurado, não disca.
 */
export interface LiveKitConfig {
  url: string; // https://livekit.sendtur.com.br
  apiKey: string;
  apiSecret: string;
  outboundTrunkId: string;
  agentName: string;
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

/** Token de acesso do LiveKit (JWT HS256), mesmo formato do AccessToken do SDK. */
export function liveKitToken(
  cfg: Pick<LiveKitConfig, 'apiKey' | 'apiSecret'>,
  grants: { video?: Record<string, unknown>; sip?: Record<string, unknown> },
  now = new Date(),
  ttlSec = 300,
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: cfg.apiKey, sub: 'sendtur-api', nbf: iat, exp: iat + ttlSec, ...grants }));
  const sig = b64url(crypto.createHmac('sha256', cfg.apiSecret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

export function readLiveKitConfig(config: Pick<ConfigService, 'get'>): LiveKitConfig | null {
  const url = config.get<string>('LIVEKIT_URL')?.trim();
  const apiKey = config.get<string>('LIVEKIT_API_KEY')?.trim();
  const apiSecret = config.get<string>('LIVEKIT_API_SECRET')?.trim();
  const outboundTrunkId = config.get<string>('LIVEKIT_SIP_OUTBOUND_TRUNK_ID')?.trim();
  if (!url || !apiKey || !apiSecret || !outboundTrunkId) return null;
  return {
    url: url.replace(/^wss?:/, 'https:').replace(/\/+$/, ''),
    apiKey,
    apiSecret,
    outboundTrunkId,
    agentName: config.get<string>('LIVEKIT_AGENT_NAME')?.trim() || 'aline-voz',
  };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

@Injectable()
export class LiveKitDialer {
  private readonly logger = new Logger(LiveKitDialer.name);
  private readonly cfg: LiveKitConfig | null;
  private readonly fetchImpl: FetchLike;

  constructor(config: ConfigService) {
    this.cfg = readLiveKitConfig(config);
    this.fetchImpl = fetch;
  }

  get configured(): boolean {
    return this.cfg !== null;
  }

  /** Para testes. */
  static withConfig(cfg: LiveKitConfig | null, fetchImpl: FetchLike): LiveKitDialer {
    const d = Object.create(LiveKitDialer.prototype) as LiveKitDialer;
    Object.assign(d, { cfg, fetchImpl, logger: new Logger(LiveKitDialer.name) });
    return d;
  }

  private async twirp(service: string, method: string, body: Record<string, unknown>, token: string) {
    const res = await this.fetchImpl(`${this.cfg!.url}/twirp/livekit.${service}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`LiveKit ${method} ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  }

  /**
   * Despacha a Aline na sala (com a missão) e liga para o cliente.
   * `phoneE164` no formato +55DDDNUMERO.
   */
  async dial(input: { room: string; phoneE164: string; missionMetadata: string; contactName: string }): Promise<void> {
    if (!this.cfg) throw new Error('LiveKit não configurado (LIVEKIT_URL/API_KEY/API_SECRET/SIP_OUTBOUND_TRUNK_ID)');
    if (!/^\+\d{10,15}$/.test(input.phoneE164)) throw new Error('Telefone inválido para discagem');
    await this.twirp(
      'AgentDispatchService',
      'CreateDispatch',
      { room: input.room, agentName: this.cfg.agentName, metadata: input.missionMetadata },
      liveKitToken(this.cfg, { video: { roomAdmin: true, room: input.room } }),
    );
    await this.twirp(
      'SIP',
      'CreateSIPParticipant',
      {
        sipTrunkId: this.cfg.outboundTrunkId,
        sipCallTo: input.phoneE164,
        roomName: input.room,
        participantIdentity: 'cliente',
        participantName: input.contactName.slice(0, 60),
        playDialtone: false,
      },
      liveKitToken(this.cfg, { sip: { call: true }, video: { roomAdmin: true, room: input.room } }),
    );
    this.logger.log(`Ligação disparada na sala ${input.room}`);
  }
}
