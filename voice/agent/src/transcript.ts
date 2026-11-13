/**
 * Transcrição de ligação de vendedor (pessoa): o agente entra calado na sala,
 * toca o aviso de gravação quando o cliente atende e anota quem falou o quê.
 * Aqui só a parte sem áudio (missão e montagem do resultado).
 */
export type Speaker = 'cliente' | 'vendedor';

export interface TranscriptSegment {
  quem: Speaker;
  texto: string;
  /** Momento da fala (ms desde 1970), só para ordenar. */
  em: number;
}

export interface CallTranscriptPayload {
  callId: string;
  answered: boolean;
  durationSec: number;
  segments: { quem: Speaker; texto: string }[];
}

export const CLIENT_IDENTITY = 'cliente';
export const RECORDING_NOTICE = 'Esta ligação pode ser gravada.';

const CALL_ID = /^[a-z0-9]{10,40}$/i;
const MAX_SEGMENT_CHARS = 2000;
const MAX_SEGMENTS = 600;

/** Metadata `{"missao":"transcrever_vendedor","callId":"..."}` → callId; outra missão → null. */
export function transcriberCallId(metadata: string | undefined): string | null {
  if (!metadata) return null;
  try {
    const raw = JSON.parse(metadata) as Record<string, unknown>;
    if (raw.missao !== 'transcrever_vendedor') return null;
    return typeof raw.callId === 'string' && CALL_ID.test(raw.callId) ? raw.callId : null;
  } catch {
    return null;
  }
}

/** Participante da sala → quem fala (o SIP do cliente entra como "cliente"). */
export function speakerOf(identity: string): Speaker {
  return identity === CLIENT_IDENTITY ? 'cliente' : 'vendedor';
}

export class TranscriptCollector {
  #segments: TranscriptSegment[] = [];
  #answeredAt: number | null = null;

  markAnswered(at: number): void {
    this.#answeredAt ??= at;
  }

  add(quem: Speaker, texto: string, em: number): void {
    const clean = texto.replace(/\s+/g, ' ').trim();
    if (!clean || this.#segments.length >= MAX_SEGMENTS) return;
    this.#segments = [...this.#segments, { quem, texto: clean.slice(0, MAX_SEGMENT_CHARS), em }];
  }

  /** Falas em ordem; falas seguidas da mesma pessoa viram uma só. */
  payload(callId: string, endedAt: number): CallTranscriptPayload {
    const ordered = [...this.#segments].sort((a, b) => a.em - b.em);
    const merged = ordered.reduce<{ quem: Speaker; texto: string }[]>((acc, s) => {
      const last = acc[acc.length - 1];
      if (last && last.quem === s.quem) return [...acc.slice(0, -1), { quem: s.quem, texto: `${last.texto} ${s.texto}` }];
      return [...acc, { quem: s.quem, texto: s.texto }];
    }, []);
    const answered = this.#answeredAt !== null;
    return {
      callId,
      answered,
      durationSec: answered ? Math.max(0, Math.round((endedAt - this.#answeredAt!) / 1000)) : 0,
      segments: merged,
    };
  }
}
