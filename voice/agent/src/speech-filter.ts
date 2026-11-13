/**
 * Limpa o texto do LLM antes de virar fala. O texto chega em pedaços (stream),
 * então o filtro guarda estado: um <think> pode abrir num pedaço e fechar noutro.
 * Remove: blocos <think>…</think>, markdown (*, _, #, `, listas), links e emojis.
 */
const OPEN = '<think>';
const CLOSE = '</think>';
const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
const MARKDOWN_RE = /[*_#`>|~]/g;
const LIST_RE = /(^|\n)\s*(?:[-•]|\d+[.)])\s+/g;

export function cleanForSpeech(text: string): string {
  return text
    .replace(URL_RE, '')
    .replace(EMOJI_RE, '')
    .replace(LIST_RE, '$1')
    .replace(MARKDOWN_RE, '')
    .replace(/[ \t]{2,}/g, ' ');
}

export class SpeechFilter {
  private inThink = false;
  private pending = '';

  /** Recebe um pedaço do stream e devolve o que já pode ser falado. */
  push(chunk: string): string {
    let buf = this.pending + chunk;
    this.pending = '';
    let out = '';
    while (buf.length > 0) {
      const tag = this.inThink ? CLOSE : OPEN;
      const idx = buf.indexOf(tag);
      if (idx >= 0) {
        if (!this.inThink) out += buf.slice(0, idx);
        buf = buf.slice(idx + tag.length);
        this.inThink = !this.inThink;
        continue;
      }
      // Guarda um possível começo de tag cortado no fim do pedaço.
      const keep = partialTagSuffix(buf, tag);
      if (!this.inThink) out += buf.slice(0, buf.length - keep);
      this.pending = buf.slice(buf.length - keep);
      buf = '';
    }
    return cleanForSpeech(out);
  }

  /** Fim do stream: solta o que sobrou (nunca o conteúdo de um <think> aberto). */
  flush(): string {
    const rest = this.inThink ? '' : this.pending;
    this.pending = '';
    return cleanForSpeech(rest);
  }
}

function partialTagSuffix(text: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
    if (tag.startsWith(text.slice(text.length - n))) return n;
  }
  return 0;
}

export function filterSpeechStream(
  source: ReadableStream<string> | AsyncIterable<string>,
): ReadableStream<string> {
  const filter = new SpeechFilter();
  const iterable = source as AsyncIterable<string>;
  return new ReadableStream<string>({
    async start(controller) {
      try {
        for await (const chunk of iterable) {
          const text = filter.push(chunk);
          if (text) controller.enqueue(text);
        }
        const tail = filter.flush();
        if (tail) controller.enqueue(tail);
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
