import { Logger } from '@nestjs/common';
import { QUOTE_HOTEL_PHOTO_RE } from '../quote.constants';
import type { QuoteData } from '../quote.types';

/** Fotos por hotel no PDF e teto do documento (cada foto tem ~0,5–1 MB). */
export const PDF_PHOTOS_PER_HOTEL = 2;
const PDF_MAX_PHOTOS = 6;
const PHOTO_TIMEOUT_MS = 6_000;
const PHOTO_MAX_BYTES = 2_500_000;

const logger = new Logger('QuoteHotelPhotos');

export type PhotoFetch = (url: string) => Promise<{ ok: boolean; type: string; bytes: ArrayBuffer }>;

const defaultFetch: PhotoFetch = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
  return { ok: res.ok, type: res.headers.get('content-type') ?? '', bytes: await res.arrayBuffer() };
};

/** As fotos que o PDF mostra: as primeiras de cada hotel, até o teto. */
export function pdfPhotoUrls(quote: QuoteData): string[] {
  const urls = quote.items.flatMap((i) => (i.hotel?.photos ?? []).slice(0, PDF_PHOTOS_PER_HOTEL));
  return [...new Set(urls.filter((u) => QUOTE_HOTEL_PHOTO_RE.test(u)))].slice(0, PDF_MAX_PHOTOS);
}

/**
 * O PDF é gerado sem rede (CSP só aceita data:), então as fotos vão
 * embutidas. Foto que falhar some do PDF; o PDF nunca falha por causa dela.
 */
export async function fetchPdfPhotos(quote: QuoteData, get: PhotoFetch = defaultFetch): Promise<ReadonlyMap<string, string>> {
  const entries = await Promise.all(
    pdfPhotoUrls(quote).map(async (url): Promise<[string, string] | null> => {
      try {
        const res = await get(url);
        if (!res.ok || !/^image\/(jpeg|png|webp)$/.test(res.type) || res.bytes.byteLength > PHOTO_MAX_BYTES) return null;
        return [url, `data:${res.type};base64,${Buffer.from(res.bytes).toString('base64')}`];
      } catch (err) {
        logger.warn(`hotel_photo_failed url=${url}: ${(err as Error).message}`);
        return null;
      }
    }),
  );
  return new Map(entries.filter((e): e is [string, string] => e !== null));
}
