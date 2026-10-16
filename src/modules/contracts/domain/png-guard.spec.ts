import { crc32, deflateSync } from 'zlib';
import { assertSafePng } from './png-guard';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

function ihdr(width: number, height: number, bitDepth = 8, colorType = 6, interlace = 0): Buffer {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(width, 0);
  d.writeUInt32BE(height, 4);
  d[8] = bitDepth;
  d[9] = colorType;
  d[10] = 0;
  d[11] = 0;
  d[12] = interlace;
  return chunk('IHDR', d);
}

/** PNG RGBA de verdade (transparente), com CRC e IDAT comprimido. */
function realPng(width: number, height: number): Buffer {
  const row = Buffer.alloc(1 + width * 4);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([SIGNATURE, ihdr(width, height), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

describe('assertSafePng', () => {
  it('aceita um PNG real de 200x60', () => {
    expect(() => assertSafePng(realPng(200, 60))).not.toThrow();
  });

  it('recusa IHDR de 30000x30000 (bomba de descompressão)', () => {
    const png = Buffer.concat([SIGNATURE, ihdr(30000, 30000), chunk('IEND', Buffer.alloc(0))]);
    expect(() => assertSafePng(png)).toThrow('Assinatura inválida');
  });

  it('recusa IHDR truncado e assinatura errada', () => {
    expect(() => assertSafePng(realPng(200, 60).subarray(0, 20))).toThrow('Assinatura inválida');
    expect(() => assertSafePng(Buffer.from([...SIGNATURE, 1, 2, 3]))).toThrow('Assinatura inválida');
    const bad = realPng(200, 60);
    bad[0] = 0;
    expect(() => assertSafePng(bad)).toThrow('Assinatura inválida');
  });

  it('recusa limites: largura 0 ou > 2000, altura > 1000', () => {
    for (const [w, h] of [[0, 60], [2001, 60], [200, 0], [200, 1001]]) {
      const png = Buffer.concat([SIGNATURE, ihdr(w, h), chunk('IEND', Buffer.alloc(0))]);
      expect(() => assertSafePng(png)).toThrow('Assinatura inválida');
    }
    const edge = Buffer.concat([SIGNATURE, ihdr(2000, 1000), chunk('IEND', Buffer.alloc(0))]);
    expect(() => assertSafePng(edge)).not.toThrow();
  });

  it('recusa bit depth, color type e interlace fora do padrão', () => {
    for (const args of [[3, 6, 0], [8, 1, 0], [8, 7, 0], [8, 6, 2]] as const) {
      const png = Buffer.concat([SIGNATURE, ihdr(10, 10, ...args), chunk('IEND', Buffer.alloc(0))]);
      expect(() => assertSafePng(png)).toThrow('Assinatura inválida');
    }
  });

  it('recusa primeiro chunk que não é IHDR ou com length diferente de 13', () => {
    const wrongType = Buffer.from(realPng(10, 10));
    wrongType.write('IDAT', 12, 'latin1');
    expect(() => assertSafePng(wrongType)).toThrow('Assinatura inválida');
    const wrongLen = Buffer.from(realPng(10, 10));
    wrongLen.writeUInt32BE(14, 8);
    expect(() => assertSafePng(wrongLen)).toThrow('Assinatura inválida');
  });

  it('recusa entrada vazia', () => {
    expect(() => assertSafePng(Buffer.alloc(0))).toThrow('Assinatura inválida');
    expect(() => assertSafePng(null as unknown as Buffer)).toThrow('Assinatura inválida');
  });
});
