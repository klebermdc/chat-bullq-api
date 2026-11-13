/**
 * fetch do TTS: UMA requisição por vez, na ordem de chegada, com streaming.
 *
 * O agents-js pede o áudio de todas as frases da resposta em paralelo; num TTS
 * de máquina pequena elas disputam CPU/GPU e a 1ª frase — a única que o cliente
 * espera — sai lenta. Em fila, a 1ª frase vai sozinha. O corpo é repassado em
 * streaming e a vez só é liberada quando a frase termina (ou falha/é cancelada).
 *
 * `extraBody` acrescenta campos ao JSON do pedido (ex.: lang_code, stream do
 * mlx-audio), para trocar de servidor de voz só por configuração.
 */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface SerialFetchOptions {
  base?: FetchLike;
  extraBody?: Record<string, unknown>;
}

export function mergeJsonBody(init: RequestInit | undefined, extra: Record<string, unknown> | undefined): RequestInit | undefined {
  if (!extra || Object.keys(extra).length === 0 || typeof init?.body !== 'string') return init;
  try {
    const parsed = JSON.parse(init.body) as Record<string, unknown>;
    // O corpo muda de tamanho: tira o content-length antigo (o fetch recalcula).
    return { ...init, headers: withoutContentLength(init.headers), body: JSON.stringify({ ...parsed, ...extra }) };
  } catch {
    return init;
  }
}

function withoutContentLength(headers: HeadersInit | undefined): HeadersInit | undefined {
  if (!headers) return headers;
  if (headers instanceof Headers) {
    const copy = new Headers(headers);
    copy.delete('content-length');
    return copy;
  }
  if (Array.isArray(headers)) return headers.filter(([k]) => k.toLowerCase() !== 'content-length');
  return Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'content-length'));
}

export function createSerialFetch(options: SerialFetchOptions = {}): FetchLike {
  const base = options.base ?? fetch;
  let tail: Promise<void> = Promise.resolve();

  return async (input, init) => {
    let release!: () => void;
    const done = new Promise<void>((r) => (release = r));
    const previous = tail;
    tail = previous.then(() => done);
    await previous;

    let res: Response;
    try {
      res = await base(input, mergeJsonBody(init, options.extraBody));
    } catch (err) {
      release();
      throw err;
    }
    if (!res.body) {
      release();
      return res;
    }
    const reader = res.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done: end, value } = await reader.read();
          if (end) {
            release();
            controller.close();
          } else {
            controller.enqueue(value);
          }
        } catch (err) {
          release();
          controller.error(err);
        }
      },
      async cancel(reason) {
        release();
        await reader.cancel(reason);
      },
    });
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}

/** fetch que só acrescenta campos extras ao JSON do pedido (sem fila). */
export function createExtraBodyFetch(extraBody: Record<string, unknown>, base: FetchLike = fetch): FetchLike {
  return (input, init) => base(input, mergeJsonBody(init, extraBody));
}
