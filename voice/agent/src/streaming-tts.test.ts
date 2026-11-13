import { initializeLogger } from '@livekit/agents';
import type { OpenAI } from 'openai';
import { beforeAll, describe, expect, test } from 'vitest';
import { StreamingTTS } from './streaming-tts.js';

const RATE = 24000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 100 ms de PCM 16 bits mono. */
const chunk100ms = () => new Uint8Array((RATE / 10) * 2).fill(1);

function fakeClient(onRequest: (body: Record<string, unknown>) => void, gapMs: number, chunks: number) {
  return {
    baseURL: 'http://tts.local/v1',
    audio: {
      speech: {
        create: async (body: Record<string, unknown>) => {
          onRequest(body);
          const stream = new ReadableStream<Uint8Array>({
            async start(c) {
              for (let i = 0; i < chunks; i++) {
                c.enqueue(chunk100ms());
                await sleep(gapMs);
              }
              c.close();
            },
          });
          return new Response(stream);
        },
      },
    },
  } as unknown as OpenAI;
}

describe('StreamingTTS', () => {
  beforeAll(() => initializeLogger({ pretty: false, level: 'fatal' }));

  test('entrega o 1º frame antes de o servidor terminar a frase', async () => {
    let pedido: Record<string, unknown> = {};
    const t = new StreamingTTS({ client: fakeClient((b) => (pedido = b), 60, 6), model: 'qwen', voice: 'serena' });
    const t0 = Date.now();
    let primeiro = -1;
    let frames = 0;
    let ultimoFinal = false;
    for await (const ev of t.synthesize('Oi, tudo bem?')) {
      if (primeiro < 0) primeiro = Date.now() - t0;
      frames++;
      ultimoFinal = ev.final;
    }
    const total = Date.now() - t0;
    expect(pedido).toMatchObject({ input: 'Oi, tudo bem?', model: 'qwen', voice: 'serena', response_format: 'pcm' });
    expect(frames).toBeGreaterThanOrEqual(5);
    expect(ultimoFinal).toBe(true);
    expect(primeiro).toBeLessThan(total / 2);
  });
});
