/** Caracteres de contexto de cada lado do termo no trecho devolvido. */
export const SNIPPET_RADIUS = 60;

/**
 * Texto pesquisável de uma mensagem: o texto, ou a legenda quando é mídia.
 * São as duas chaves onde alguém escreve — as mesmas que o SQL da busca varre.
 */
export function messageText(content: unknown): string {
  if (!content || typeof content !== 'object') return '';
  const { text, caption } = content as { text?: unknown; caption?: unknown };
  if (typeof text === 'string') return text;
  if (typeof caption === 'string') return caption;
  return '';
}

/**
 * Neutraliza os coringas do LIKE. Sem isto, um "%" digitado pelo usuário vira
 * curinga e a busca casa a conversa inteira. A barra invertida vai primeiro,
 * senão o escape dos coringas seria escapado de novo.
 */
export function escapeLikeTerm(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/[%_]/g, (c) => `\\${c}`);
}

/**
 * Trecho do texto centrado no termo, para o painel de resultados mostrar o
 * contexto em vez da mensagem inteira. Quando o termo não aparece — casou pela
 * legenda de uma mídia, por exemplo — mostra o começo do texto.
 */
export function buildSnippet(text: string, term: string): string {
  if (!text) return '';

  const at = text.toLowerCase().indexOf(term.toLowerCase());
  const center = at === -1 ? 0 : at;
  const start = Math.max(0, center - SNIPPET_RADIUS);
  const end = Math.min(text.length, center + term.length + SNIPPET_RADIUS);

  if (start === 0 && end === text.length) return text;

  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
