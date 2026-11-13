import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { SendturVoiceClient, signBody } from './sendtur-client.js';

const NOW = new Date('2026-11-16T15:00:00Z');

function fakeFetch(status: number, json: unknown, seen: { url?: string; init?: RequestInit }[]) {
  return async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  };
}

describe('SendturVoiceClient', () => {
  test('assina igual à API: hmac(segredo, `${ts}.${corpo}`) em hex', async () => {
    const seen: { url?: string; init?: RequestInit }[] = [];
    const c = new SendturVoiceClient('https://api.exemplo/', 's3gr3d0', fakeFetch(200, { vendedor: 'Renata', horarios: [] }, seen), () => NOW);
    await c.freeSlots('cv1', 3);
    const { url, init } = seen[0];
    const headers = init!.headers as Record<string, string>;
    const ts = String(NOW.getTime() / 1000);
    expect(url).toBe('https://api.exemplo/voice/tools/free-slots');
    expect(headers['x-voice-timestamp']).toBe(ts);
    const esperado = createHmac('sha256', 's3gr3d0').update(`${ts}.${init!.body}`).digest('hex');
    expect(headers['x-voice-signature']).toBe(esperado);
    expect(signBody('s3gr3d0', ts, String(init!.body))).toBe(esperado);
  });

  test('recusa de regra vira resposta para a Aline, não exceção', async () => {
    const c = new SendturVoiceClient('https://x', 's', fakeFetch(400, { statusCode: 400, message: { code: 'CONFLITO', message: 'O vendedor já tem compromisso nesse horário.' } }, []), () => NOW);
    await expect(c.schedule({ conversationId: 'cv1', startsAt: '2026-11-16T18:00:00Z' })).resolves.toEqual({
      ok: false,
      codigo: 'CONFLITO',
      mensagem: 'O vendedor já tem compromisso nesse horário.',
    });
  });

  test('horários livres com erro de servidor viram exceção', async () => {
    const c = new SendturVoiceClient('https://x', 's', fakeFetch(500, {}, []), () => NOW);
    await expect(c.freeSlots('cv1')).rejects.toThrow('free-slots falhou (500)');
  });
});
