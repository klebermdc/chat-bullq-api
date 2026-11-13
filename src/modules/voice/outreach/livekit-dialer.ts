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
  who: { identity?: string; name?: string } = {},
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ iss: cfg.apiKey, sub: who.identity ?? 'sendtur-api', ...(who.name && { name: who.name }), nbf: iat, exp: iat + ttlSec, ...grants }),
  );
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

const TWIRP_TIMEOUT_MS = 30_000;
/** A recusa de SDP da Meta chega ~2 s depois do INVITE; passado isso, está chamando. */
const EARLY_FAILURE_MS = 4_000;
const RINGING_TIMEOUT_S = 50;
/** 13/11: 3 de 6 ligações levaram o 403 de SDP na 1ª tentativa. */
const MAX_DIAL_ATTEMPTS = 3;

export function isSdpRejection(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /403/.test(msg) && /SDP/i.test(msg);
}

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
  static withConfig(cfg: LiveKitConfig | null, fetchImpl: FetchLike, earlyFailureMs = EARLY_FAILURE_MS): LiveKitDialer {
    const d = Object.create(LiveKitDialer.prototype) as LiveKitDialer;
    Object.assign(d, { cfg, fetchImpl, earlyFailureMs, logger: new Logger(LiveKitDialer.name) });
    return d;
  }

  private earlyFailureMs = EARLY_FAILURE_MS;

  private async twirp(service: string, method: string, body: Record<string, unknown>, token: string, timeoutMs = TWIRP_TIMEOUT_MS) {
    const res = await this.fetchImpl(`${this.cfg!.url}/twirp/livekit.${service}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`LiveKit ${method} ${res.status}: ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : {};
  }

  private requireConfig(phoneE164: string): LiveKitConfig {
    if (!this.cfg) throw new Error('LiveKit não configurado (LIVEKIT_URL/API_KEY/API_SECRET/SIP_OUTBOUND_TRUNK_ID)');
    if (!/^\+\d{10,15}$/.test(phoneE164)) throw new Error('Telefone inválido para discagem');
    return this.cfg;
  }

  /**
   * Cria o participante SIP esperando a resposta da Meta, mas só pelos
   * primeiros segundos: recusa imediata (ex.: 403 de SDP) vira erro; se não
   * recusou nesse prazo, está chamando e seguimos sem bloquear.
   */
  private async callClient(cfg: LiveKitConfig, room: string, phoneE164: string, contactName: string): Promise<void> {
    const call = this.twirp(
      'SIP',
      'CreateSIPParticipant',
      {
        sipTrunkId: cfg.outboundTrunkId,
        sipCallTo: phoneE164,
        roomName: room,
        participantIdentity: 'cliente',
        participantName: contactName.slice(0, 60),
        playDialtone: false,
        waitUntilAnswered: true,
        ringingTimeout: `${RINGING_TIMEOUT_S}s`,
      },
      liveKitToken(cfg, { sip: { call: true }, video: { roomAdmin: true, room } }),
      (RINGING_TIMEOUT_S + 20) * 1000,
    );
    let timer: NodeJS.Timeout | undefined;
    const stillRinging = new Promise<'chamando'>((resolve) => {
      timer = setTimeout(() => resolve('chamando'), this.earlyFailureMs);
    });
    try {
      const outcome = await Promise.race([call.then(() => 'atendeu' as const), stillRinging]);
      if (outcome === 'chamando') {
        call.catch((err: Error) => this.logger.log(`Ligação na sala ${room} terminou sem atender: ${err.message}`));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** Põe o agente de voz na sala com a missão (a Aline, ou o transcritor da ligação do vendedor). */
  async dispatchAgent(room: string, metadata: string): Promise<void> {
    if (!this.cfg) throw new Error('LiveKit não configurado (LIVEKIT_URL/API_KEY/API_SECRET/SIP_OUTBOUND_TRUNK_ID)');
    await this.twirp(
      'AgentDispatchService',
      'CreateDispatch',
      { room, agentName: this.cfg.agentName, metadata },
      liveKitToken(this.cfg, { video: { roomAdmin: true, room } }),
    );
  }

  /**
   * Despacha a Aline na sala (com a missão) e liga para o cliente.
   * `phoneE164` no formato +55DDDNUMERO. Devolve a sala usada (muda se precisou
   * discar de novo: a Aline encerra a sala quando a tentativa cai).
   */
  async dial(input: { room: string; phoneE164: string; missionMetadata: string; contactName: string }): Promise<string> {
    const cfg = this.requireConfig(input.phoneE164);
    const room = await this.withSdpRetry(input.room, async (attempt) => {
      const target = attempt === 1 ? input.room : `${input.room}-${attempt}`;
      await this.dispatchAgent(target, input.missionMetadata);
      await this.callClient(cfg, target, input.phoneE164, input.contactName);
      return target;
    });
    this.logger.log(`Ligação disparada na sala ${room}`);
    return room;
  }

  /** Vendedor liga: só disca para o cliente (o transcritor é despachado à parte). */
  async dialForSeller(input: { room: string; phoneE164: string; contactName: string }): Promise<void> {
    const cfg = this.requireConfig(input.phoneE164);
    await this.withSdpRetry(input.room, () => this.callClient(cfg, input.room, input.phoneE164, input.contactName));
  }

  /** A Meta às vezes recusa o SDP antes de tocar (403); novas tentativas costumam passar. */
  private async withSdpRetry<T>(room: string, attempt: (n: number) => Promise<T>): Promise<T> {
    for (let n = 1; ; n++) {
      try {
        return await attempt(n);
      } catch (err) {
        if (!isSdpRejection(err) || n >= MAX_DIAL_ATTEMPTS) throw err;
        this.logger.warn(`Meta recusou o SDP na sala ${room} (tentativa ${n}); discando de novo`);
      }
    }
  }

  /** Acesso do navegador do vendedor à sala (fala e escuta; vale 2 h). */
  joinAccess(input: { room: string; identity: string; name: string }): { url: string; token: string } {
    if (!this.cfg) throw new Error('LiveKit não configurado');
    const token = liveKitToken(
      this.cfg,
      { video: { roomJoin: true, room: input.room, canPublish: true, canSubscribe: true } },
      new Date(),
      2 * 3600,
      { identity: input.identity, name: input.name },
    );
    return { url: this.cfg.url.replace(/^https:/, 'wss:'), token };
  }

  /** Encerra a ligação: apaga a sala (derruba o cliente e o vendedor). */
  async endRoom(room: string): Promise<void> {
    if (!this.cfg) return;
    await this.twirp('RoomService', 'DeleteRoom', { room }, liveKitToken(this.cfg, { video: { roomCreate: true } }));
  }
}
