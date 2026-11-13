import { createHmac } from 'node:crypto';
import type { CallTranscriptPayload } from './transcript.js';

/**
 * Cliente das ferramentas de voz da API do Sendtur (/voice/tools/*).
 * Assina `${timestamp}.${corpo}` com HMAC-SHA256 (VOICE_SERVICE_SECRET) —
 * o mesmo formato que a API confere (voice-signature.util.ts).
 */
export interface FreeSlot {
  inicio: string;
  falado: string;
}

export interface FreeSlotsResult {
  vendedor: string | null;
  horarios: FreeSlot[];
}

export type ScheduleResult =
  | { ok: true; compromissoId: string; falado: string; confirmacaoEnviada: boolean }
  | { ok: false; codigo: string; mensagem: string };

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 8000;

export function signBody(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
}

export class SendturVoiceClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async post(path: string, payload: Record<string, unknown>): Promise<{ status: number; json: any }> {
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(this.now().getTime() / 1000));
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-voice-timestamp': timestamp,
        'x-voice-signature': signBody(this.secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  async freeSlots(conversationId: string, count = 4): Promise<FreeSlotsResult> {
    const { status, json } = await this.post('/voice/tools/free-slots', { conversationId, count });
    if (status !== 200) throw new Error(`free-slots falhou (${status})`);
    return json as FreeSlotsResult;
  }

  async schedule(input: { conversationId: string; startsAt: string; notes?: string }): Promise<ScheduleResult> {
    const { status, json } = await this.post('/voice/tools/schedule', input);
    if (status === 200) return json as ScheduleResult;
    // Recusa de regra (fora do expediente, conflito…) volta para a Aline oferecer outro horário.
    const codigo = String(json?.code ?? json?.message?.code ?? `HTTP_${status}`);
    const mensagem = String(json?.message?.message ?? json?.message ?? 'Não consegui marcar esse horário.');
    return { ok: false, codigo, mensagem };
  }

  /** Fim da ligação do vendedor: a API grava a transcrição e gera o resumo. */
  async callTranscript(payload: CallTranscriptPayload): Promise<void> {
    const { status } = await this.post('/voice/tools/call-transcript', payload as unknown as Record<string, unknown>);
    if (status !== 200) throw new Error(`call-transcript falhou (${status})`);
  }
}
