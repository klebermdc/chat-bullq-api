/** Página padrão da timeline — o mesmo tamanho que o chat já carregava. */
export const DEFAULT_PAGE_SIZE = 50;

/** Teto de qualquer página. Sem ele, `?limit=100000` puxa a conversa inteira. */
export const MAX_PAGE_SIZE = 200;

/** Resultados devolvidos pela busca dentro da conversa. */
export const SEARCH_RESULT_LIMIT = 50;

/** Mensagens de cada lado da âncora na janela do "pular até". */
export const WINDOW_RADIUS = 25;

/**
 * Lê um tamanho de página vindo da query string. Valor ausente, ilegível ou
 * não-positivo cai no padrão; acima do teto, corta.
 */
export function clampPageSize(raw: string | undefined, fallback: number): number {
  const parsed = parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_PAGE_SIZE);
}
