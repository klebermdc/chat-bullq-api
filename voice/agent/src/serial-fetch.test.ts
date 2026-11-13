import { describe, expect, test } from 'vitest';
import { createSerialFetch, mergeJsonBody, type FetchLike } from './serial-fetch.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('createSerialFetch', () => {
  test('nunca roda duas requisições ao mesmo tempo e respeita a ordem', async () => {
    let ativas = 0;
    let maxAtivas = 0;
    const ordem: string[] = [];
    const base: FetchLike = async (input) => {
      ativas++;
      maxAtivas = Math.max(maxAtivas, ativas);
      await sleep(String(input).endsWith('1') ? 30 : 5);
      ordem.push(String(input));
      ativas--;
      return new Response(String(input));
    };
    const f = createSerialFetch({ base });
    const textos = await Promise.all(['f1', 'f2', 'f3'].map((u) => f(u).then((r) => r.text())));
    expect(maxAtivas).toBe(1);
    expect(ordem).toEqual(['f1', 'f2', 'f3']);
    expect(textos).toEqual(['f1', 'f2', 'f3']);
  });

  test('só libera a próxima quando o corpo (stream) da anterior termina', async () => {
    const eventos: string[] = [];
    const base: FetchLike = async (input) => {
      eventos.push(`inicio ${input}`);
      const stream = new ReadableStream<Uint8Array>({
        async start(c) {
          c.enqueue(new TextEncoder().encode('a'));
          await sleep(20);
          c.enqueue(new TextEncoder().encode('b'));
          eventos.push(`fim ${input}`);
          c.close();
        },
      });
      return new Response(stream);
    };
    const f = createSerialFetch({ base });
    const r1 = f('f1');
    const r2 = f('f2');
    const t1 = await (await r1).text();
    const t2 = await (await r2).text();
    expect([t1, t2]).toEqual(['ab', 'ab']);
    expect(eventos).toEqual(['inicio f1', 'fim f1', 'inicio f2', 'fim f2']);
  });

  test('erro numa requisição não trava a fila', async () => {
    const base: FetchLike = async (input) => {
      if (String(input) === 'ruim') throw new Error('falhou');
      return new Response('ok', { status: 200 });
    };
    const f = createSerialFetch({ base });
    await expect(f('ruim')).rejects.toThrow('falhou');
    await expect(f('boa').then((r) => r.text())).resolves.toBe('ok');
  });

  test('mantém status e cabeçalhos da resposta', async () => {
    const base: FetchLike = async () => new Response('x', { status: 404, headers: { 'content-type': 'audio/pcm' } });
    const res = await createSerialFetch({ base })('u');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('audio/pcm');
  });

  test('acrescenta os campos extras ao JSON do pedido', async () => {
    let enviado = '';
    const base: FetchLike = async (_i, init) => {
      enviado = String(init?.body);
      return new Response('ok');
    };
    const f = createSerialFetch({ base, extraBody: { lang_code: 'portuguese', stream: true } });
    await (await f('u', { method: 'POST', body: JSON.stringify({ model: 'm', input: 'oi' }) })).text();
    expect(JSON.parse(enviado)).toEqual({ model: 'm', input: 'oi', lang_code: 'portuguese', stream: true });
  });
});

describe('mergeJsonBody', () => {
  test('remove o content-length antigo quando o corpo muda (objeto e Headers)', () => {
    const body = JSON.stringify({ a: 1 });
    const obj = mergeJsonBody({ body, headers: { 'Content-Length': String(body.length), 'x-api-key': 'k' } }, { b: 2 });
    expect(obj?.headers).toEqual({ 'x-api-key': 'k' });
    const h = mergeJsonBody({ body, headers: new Headers({ 'content-length': '7', accept: 'x' }) }, { b: 2 })?.headers as Headers;
    expect(h.get('content-length')).toBeNull();
    expect(h.get('accept')).toBe('x');
  });

  test('não mexe em corpo que não é JSON (ex.: multipart do STT)', () => {
    const form = new FormData();
    const init = { method: 'POST', body: form };
    expect(mergeJsonBody(init, { a: 1 })).toBe(init);
  });
});
