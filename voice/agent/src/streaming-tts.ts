import { AudioByteStream, shortuuid, tts, type APIConnectOptions } from '@livekit/agents';
import type { OpenAI } from 'openai';

/**
 * TTS compatível com a API da OpenAI (/v1/audio/speech, PCM 16 bits mono) que
 * TOCA ENQUANTO RECEBE: cada pedaço de áudio vira frame assim que chega.
 * O plugin oficial lê a resposta inteira (arrayBuffer) antes de tocar, o que
 * joga fora o streaming de servidores como mlx-audio/Qwen3-TTS e vLLM-Omni.
 */
const CHANNELS = 1;

/** Cancelamento por interrupção (barge-in): não é erro. O SDK da OpenAI usa APIUserAbortError. */
export function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || err.constructor?.name === 'APIUserAbortError' || err.message === 'Request was aborted.';
}

export interface StreamingTtsOptions {
  client: OpenAI;
  model: string;
  voice: string;
  speed?: number;
  sampleRate?: number;
}

export class StreamingTTS extends tts.TTS {
  label = 'sendtur.StreamingTTS';
  readonly #opts: Required<StreamingTtsOptions>;
  readonly #abort = new AbortController();

  constructor(opts: StreamingTtsOptions) {
    const sampleRate = opts.sampleRate ?? 24000;
    super(sampleRate, CHANNELS, { streaming: false });
    this.#opts = { speed: 1, sampleRate, ...opts };
  }

  get model(): string {
    return this.#opts.model;
  }

  get provider(): string {
    try {
      return new URL(this.#opts.client.baseURL).host;
    } catch {
      return 'openai-compatible';
    }
  }

  synthesize(text: string, connOptions?: APIConnectOptions, abortSignal?: AbortSignal): tts.ChunkedStream {
    const signal = abortSignal ? AbortSignal.any([abortSignal, this.#abort.signal]) : this.#abort.signal;
    const response = this.#opts.client.audio.speech.create(
      {
        input: text,
        model: this.#opts.model,
        voice: this.#opts.voice as never,
        response_format: 'pcm',
        speed: this.#opts.speed,
      },
      { signal },
    );
    return new StreamingChunkedStream(this, text, response, connOptions, signal);
  }

  stream(): tts.SynthesizeStream {
    throw new Error('StreamingTTS trabalha frase a frase (synthesize); use o adaptador de frases do agents-js');
  }

  async close(): Promise<void> {
    this.#abort.abort();
  }
}

class StreamingChunkedStream extends tts.ChunkedStream {
  label = 'sendtur.StreamingChunkedStream';
  readonly #response: Promise<Response>;
  readonly #sampleRate: number;

  constructor(
    owner: StreamingTTS,
    text: string,
    response: Promise<Response>,
    connOptions: APIConnectOptions | undefined,
    signal: AbortSignal,
  ) {
    super(text, owner, connOptions, signal);
    this.#response = response;
    this.#sampleRate = owner.sampleRate;
  }

  protected async run(): Promise<void> {
    const requestId = shortuuid();
    const bytes = new AudioByteStream(this.#sampleRate, CHANNELS);
    let pending: ReturnType<AudioByteStream['write']>[number] | undefined;
    const emit = (frame: typeof pending, final: boolean) => {
      if (frame) this.queue.put({ requestId, segmentId: requestId, frame, final });
    };
    const push = (frames: ReturnType<AudioByteStream['write']>) => {
      for (const frame of frames) {
        emit(pending, false);
        pending = frame;
      }
    };
    try {
      const res = await this.#response;
      if (!res.body) {
        push(bytes.write(await res.arrayBuffer()));
      } else {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value?.byteLength) {
            push(bytes.write(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer));
          }
        }
      }
      push(bytes.flush());
      emit(pending, true);
    } catch (error) {
      if (isAbortError(error)) return;
      throw error;
    } finally {
      this.queue.close();
    }
  }
}
