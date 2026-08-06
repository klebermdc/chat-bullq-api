const UPLOADS_MARKER = '/api/v1/uploads/';

/**
 * Converte a URL pública devolvida por `POST messages/uploads/media` na chave
 * do objeto no storage. Devolve `null` para qualquer coisa que não seja um
 * upload nosso — o endpoint de extração recebe URL do cliente, e sem essa
 * checagem viraria um leitor de arquivo arbitrário.
 */
export function storageKeyFromUploadUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;

  const idx = url.indexOf(UPLOADS_MARKER);
  const key = idx >= 0 ? url.slice(idx + UPLOADS_MARKER.length) : url;

  if (!key || key.includes('..') || key.startsWith('/')) return null;
  if (idx < 0 && /^[a-z]+:\/\//i.test(url)) return null;
  return key;
}
