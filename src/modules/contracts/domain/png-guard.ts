/**
 * Confere o cabeçalho de um PNG antes de ele chegar ao Chromium do PDF:
 * assinatura, IHDR como primeiro chunk e dimensões de assinatura desenhada.
 * Um PNG pequeno em bytes pode declarar 30000x30000 e explodir na decodificação.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_LENGTH = 13;
/** 8 (assinatura) + 4 (length) + 4 (type) + 13 (dados) = fim dos dados do IHDR. */
const IHDR_END = 29;
export const MAX_SIGNATURE_WIDTH = 2000;
export const MAX_SIGNATURE_HEIGHT = 1000;
const BIT_DEPTHS = new Set([1, 2, 4, 8, 16]);
const COLOR_TYPES = new Set([0, 2, 3, 4, 6]);
const INTERLACE = new Set([0, 1]);

const ERROR_MESSAGE = 'Assinatura inválida';

export function assertSafePng(buf: Buffer): void {
  if (!Buffer.isBuffer(buf) || buf.length < IHDR_END) throw new Error(ERROR_MESSAGE);
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(ERROR_MESSAGE);
  if (buf.readUInt32BE(8) !== IHDR_LENGTH || buf.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error(ERROR_MESSAGE);
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  const interlace = buf[28];
  const isValid =
    width >= 1 &&
    width <= MAX_SIGNATURE_WIDTH &&
    height >= 1 &&
    height <= MAX_SIGNATURE_HEIGHT &&
    BIT_DEPTHS.has(bitDepth) &&
    COLOR_TYPES.has(colorType) &&
    INTERLACE.has(interlace);
  if (!isValid) throw new Error(ERROR_MESSAGE);
}
