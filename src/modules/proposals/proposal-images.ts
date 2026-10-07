import { PROPOSAL_IMAGE_MIME_TYPES } from './proposals.constants';

export type ProposalImageMime = (typeof PROPOSAL_IMAGE_MIME_TYPES)[number];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function startsWith(buffer: Buffer, signature: number[], offset = 0): boolean {
  if (buffer.length < offset + signature.length) return false;
  return signature.every((byte, i) => buffer[offset + i] === byte);
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

/**
 * Descobre o tipo da imagem pelos BYTES. O `mimeType` do body é o que o
 * cliente declarou, e a chave só prova que o objeto mora em `media/` — que
 * também guarda PDF, vídeo e documento. Sem isto, um `mimeType` mentiroso
 * manda qualquer anexo do bucket para o provedor de LLM como "print".
 * Devolve `null` para o que não for PNG, JPEG ou WebP.
 */
export function sniffImageMime(buffer: Buffer): ProposalImageMime | null {
  if (startsWith(buffer, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(buffer, JPEG_SIGNATURE)) return 'image/jpeg';
  if (startsWith(buffer, ascii('RIFF')) && startsWith(buffer, ascii('WEBP'), 8)) {
    return 'image/webp';
  }
  return null;
}
